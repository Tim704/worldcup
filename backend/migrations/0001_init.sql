-- ============================================================================
-- World Cup 2026 Fantasy Hub — canonical relational schema (migration 0001)
-- Target: PostgreSQL 16 (arm64-compatible: postgres:16-alpine on Raspberry Pi).
--
-- Design rules enforced here (single source of truth for ALL services):
--   * Strict foreign keys between Users, Matches, Predictions and Forfeits.
--   * Domain enums (not free text) for every state column.
--   * The "lock-in exactly one minute before kickoff" rule is encoded at the
--     storage layer as a GENERATED column so no service can drift from it.
--   * Timestamps are TIMESTAMPTZ (UTC). All durations/intervals are metric SI
--     time (seconds/minutes) per the project's metric-only mandate.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto on PG < 18; enable it explicitly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Domain enumerations
-- ---------------------------------------------------------------------------
CREATE TYPE outcome_1x2  AS ENUM ('home', 'draw', 'away');
CREATE TYPE match_status AS ENUM ('scheduled', 'live', 'final');
CREATE TYPE proof_kind   AS ENUM ('image', 'video', 'link');

-- The Bloodline forfeit lifecycle. Terminal state is 'resolved'.
--   pending   → awaiting opponent accept/decline (or auto-expire)
--   active    → accepted; wager is live through the match
--   unsettled → match decided, loser owes proof of punishment
--   resolved  → archived (completed, declined, expired or defaulted)
CREATE TYPE forfeit_state AS ENUM ('pending', 'active', 'unsettled', 'resolved');

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username     TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    elo_rating   INTEGER     NOT NULL DEFAULT 1500,   -- see scoring: Elo seed
    total_points INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_not_blank CHECK (length(btrim(username)) > 0)
);

-- ---------------------------------------------------------------------------
-- Lock-time helper (required by the matches.lock_at GENERATED column below)
-- ---------------------------------------------------------------------------
-- WHY this function exists:
--   A STORED generated column's expression MUST be IMMUTABLE. The naive form
--   `kickoff_at - INTERVAL '1 minute'` is NOT accepted, because the operator
--   `timestamptz - interval` is only STABLE: for day/month intervals the result
--   depends on the session TimeZone (DST shifts), and an operator's volatility
--   is a fixed property regardless of the literal passed. PostgreSQL therefore
--   rejects it with "generation expression is not immutable".
--
--   Subtracting a fixed 60 SI seconds (1 minute) is, however, genuinely
--   timezone-independent and deterministic, so wrapping exactly that operation
--   in an IMMUTABLE SQL function is both correct and safe. The generated column
--   can then reference this function. Keep the body to the fixed-minute shift
--   only — do NOT generalise it to arbitrary day/month intervals, or the
--   IMMUTABLE marking would become a lie.
CREATE OR REPLACE FUNCTION calc_lock_time(k_time TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT k_time - INTERVAL '1 minute';
$$;

-- ---------------------------------------------------------------------------
-- Matches (World Cup 2026 fixtures)
-- ---------------------------------------------------------------------------
CREATE TABLE matches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ext_ref     TEXT UNIQUE,                           -- upstream feed id (ingestion idempotency)
    home_team   TEXT         NOT NULL,
    away_team   TEXT         NOT NULL,
    group_label TEXT,                                  -- e.g. 'GROUP F'
    venue       TEXT,
    kickoff_at  TIMESTAMPTZ  NOT NULL,
    -- Predictions lock exactly 60 s before kickoff. Encoded at the DB layer so
    -- the rule is identical in Rust, Python and SQL. (t_kickoff − 1 min.)
    -- Uses the IMMUTABLE calc_lock_time() wrapper above; see its comment for why
    -- the inline `kickoff_at - INTERVAL '1 minute'` is not STORED-column legal.
    lock_at     TIMESTAMPTZ  GENERATED ALWAYS AS (calc_lock_time(kickoff_at)) STORED,
    status      match_status NOT NULL DEFAULT 'scheduled',
    home_score  SMALLINT,
    away_score  SMALLINT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT matches_distinct_teams CHECK (home_team <> away_team),
    CONSTRAINT matches_scores_nonneg  CHECK (
        (home_score IS NULL OR home_score >= 0) AND
        (away_score IS NULL OR away_score >= 0)
    )
);
CREATE INDEX idx_matches_kickoff ON matches (kickoff_at);
CREATE INDEX idx_matches_status  ON matches (status);

-- ---------------------------------------------------------------------------
-- Predictions (1X2 + optional exact score)
-- ---------------------------------------------------------------------------
CREATE TABLE predictions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    match_id       UUID         NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    outcome        outcome_1x2  NOT NULL,
    exact_home     SMALLINT,
    exact_away     SMALLINT,
    is_locked      BOOLEAN      NOT NULL DEFAULT false,
    points_awarded INTEGER,                            -- NULL until settled
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT predictions_one_per_user_match UNIQUE (user_id, match_id),
    CONSTRAINT predictions_exact_nonneg CHECK (
        (exact_home IS NULL OR exact_home >= 0) AND
        (exact_away IS NULL OR exact_away >= 0)
    )
);
CREATE INDEX idx_predictions_match ON predictions (match_id);
CREATE INDEX idx_predictions_user  ON predictions (user_id);

-- ---------------------------------------------------------------------------
-- Forfeits — "The Bloodline" custom wagers between two friends
-- ---------------------------------------------------------------------------
CREATE TABLE forfeits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenger_id UUID          NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
    opponent_id   UUID          NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
    match_id      UUID          REFERENCES matches(id)          ON DELETE SET NULL,
    stake         TEXT          NOT NULL,                       -- the punishment on the line
    state         forfeit_state NOT NULL DEFAULT 'pending',
    loser_id      UUID          REFERENCES users(id)            ON DELETE SET NULL,
    -- lifecycle timestamps (UTC)
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,
    unsettled_at  TIMESTAMPTZ,
    resolved_at   TIMESTAMPTZ,
    -- timeout / nudge bookkeeping (durations are metric SI seconds elsewhere)
    nudge_count   SMALLINT      NOT NULL DEFAULT 0,
    last_nudge_at TIMESTAMPTZ,
    CONSTRAINT forfeits_distinct_parties CHECK (challenger_id <> opponent_id)
);
CREATE INDEX idx_forfeits_opponent ON forfeits (opponent_id, state);
CREATE INDEX idx_forfeits_challenger ON forfeits (challenger_id, state);
CREATE INDEX idx_forfeits_state    ON forfeits (state);

-- ---------------------------------------------------------------------------
-- Hall of Shame — proof ledger for executed punishments (one per forfeit)
-- ---------------------------------------------------------------------------
CREATE TABLE hall_of_shame (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forfeit_id UUID        NOT NULL UNIQUE REFERENCES forfeits(id) ON DELETE CASCADE,
    loser_id   UUID        NOT NULL REFERENCES users(id)           ON DELETE RESTRICT,
    proof_url  TEXT        NOT NULL,                  -- image/video/link evidence
    proof_kind proof_kind  NOT NULL,
    caption    TEXT,
    verified   BOOLEAN     NOT NULL DEFAULT false,    -- set true when tribunal passes
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hall_verified ON hall_of_shame (verified);

-- ---------------------------------------------------------------------------
-- Tribunal votes — group thumbs up/down on each Hall of Shame entry
-- ---------------------------------------------------------------------------
CREATE TABLE shame_votes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id   UUID        NOT NULL REFERENCES hall_of_shame(id) ON DELETE CASCADE,
    voter_id   UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    vote       SMALLINT    NOT NULL,                  -- +1 thumbs up, -1 thumbs down
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shame_votes_one_per_voter UNIQUE (entry_id, voter_id),
    CONSTRAINT shame_votes_value CHECK (vote IN (-1, 1))
);
CREATE INDEX idx_shame_votes_entry ON shame_votes (entry_id);
