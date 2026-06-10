-- ============================================================================
-- 0001_init.sql — The Almanac Cup v2 schema (canonical DDL, Contract §3).
-- Applied automatically on boot by src/migrate.ts inside one transaction.
-- ============================================================================

-- v1 → v2 upgrade: legacy objects out (CASCADE), pgcrypto for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DROP TABLE IF EXISTS shame_votes, hall_of_shame, forfeits, predictions, matches, users CASCADE;
DROP TYPE  IF EXISTS outcome_1x2, proof_kind, forfeit_state, match_status, wager_state, wager_pick CASCADE;
DROP FUNCTION IF EXISTS calc_lock_time(TIMESTAMPTZ);

CREATE TYPE match_status AS ENUM ('scheduled', 'live', 'final');
CREATE TYPE wager_state  AS ENUM ('PENDING', 'ACCEPTED', 'RESOLVED_WON', 'RESOLVED_LOST');
CREATE TYPE wager_pick   AS ENUM ('home', 'draw', 'away');

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username     TEXT        NOT NULL,
    display_name TEXT        NOT NULL,
    is_admin     BOOLEAN     NOT NULL DEFAULT false,
    total_points INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_not_blank CHECK (length(btrim(username)) > 0)
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

-- IMMUTABLE wrapper so the GENERATED column below is legal (fixed 60 s shift
-- is timezone-independent; `timestamptz - interval` alone is only STABLE).
CREATE FUNCTION calc_lock_time(k_time TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$ SELECT k_time - INTERVAL '1 minute'; $$;

CREATE TABLE matches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ext_ref     TEXT UNIQUE,                  -- ingest idempotency key (KEEP)
    home_team   TEXT         NOT NULL,
    away_team   TEXT         NOT NULL,
    group_label TEXT,
    venue       TEXT,
    kickoff_at  TIMESTAMPTZ  NOT NULL,
    lock_at     TIMESTAMPTZ  GENERATED ALWAYS AS (calc_lock_time(kickoff_at)) STORED,
    status      match_status NOT NULL DEFAULT 'scheduled',
    home_score  SMALLINT     CHECK (home_score IS NULL OR home_score >= 0),
    away_score  SMALLINT     CHECK (away_score IS NULL OR away_score >= 0),
    is_featured BOOLEAN      NOT NULL DEFAULT false,   -- "Main Event" flag
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT matches_distinct_teams CHECK (home_team <> away_team)
);
CREATE INDEX idx_matches_kickoff  ON matches (kickoff_at);
CREATE INDEX idx_matches_status   ON matches (status);
CREATE INDEX idx_matches_featured ON matches (is_featured) WHERE is_featured;

CREATE TABLE predictions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    match_id       UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    pred_home      SMALLINT    NOT NULL CHECK (pred_home BETWEEN 0 AND 20),
    pred_away      SMALLINT    NOT NULL CHECK (pred_away BETWEEN 0 AND 20),
    points_awarded INTEGER,                   -- NULL until the match is final
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT predictions_one_per_user_match UNIQUE (user_id, match_id)
);
CREATE INDEX idx_predictions_match ON predictions (match_id);
CREATE INDEX idx_predictions_user  ON predictions (user_id);

CREATE TABLE wagers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    creator_id  UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    acceptor_id UUID        REFERENCES users(id)            ON DELETE SET NULL,
    pick        wager_pick  NOT NULL,
    margin      SMALLINT    CHECK (margin IS NULL OR margin BETWEEN 1 AND 10),
    claim       TEXT        NOT NULL CHECK (length(btrim(claim)) BETWEEN 3 AND 140),
    forfeit     TEXT        CHECK (forfeit IS NULL OR length(btrim(forfeit)) BETWEEN 3 AND 140),
    state       wager_state NOT NULL DEFAULT 'PENDING',
    winner_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
    loser_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT wagers_distinct_parties CHECK (acceptor_id IS NULL OR acceptor_id <> creator_id),
    CONSTRAINT wagers_margin_needs_side CHECK (margin IS NULL OR pick <> 'draw')
);
CREATE INDEX idx_wagers_state ON wagers (state);
CREATE INDEX idx_wagers_match ON wagers (match_id);
