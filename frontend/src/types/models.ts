/**
 * models.ts
 * ----------------------------------------------------------------------------
 * TypeScript domain model for the World Cup 2026 Fantasy Hub frontend.
 *
 * These interfaces mirror CONTRACT §3 (the canonical PostgreSQL schema in
 * backend/migrations/0001_init.sql) EXACTLY. Field names are kept in
 * **snake_case** so the JSON returned by the Rust/Axum backend deserialises
 * straight into these types with zero key renaming on either side.
 *
 * Enum string literal unions match the PostgreSQL domain enums verbatim:
 *   outcome_1x2   → 'home' | 'draw' | 'away'
 *   proof_kind    → 'image' | 'video' | 'link'
 *   forfeit_state → 'pending' | 'active' | 'unsettled' | 'resolved'
 *
 * Timestamps are ISO-8601 strings (TIMESTAMPTZ serialised by the backend).
 * Any physical/time quantity in the wider app uses SI units (durations in
 * seconds, distances in km) per the project's metric mandate; these data
 * carriers themselves hold no unit-bearing numbers beyond scores/points.
 * ----------------------------------------------------------------------------
 */

/* ===========================================================================
 * Enum unions (string literals exactly matching the SQL ENUM members)
 * ======================================================================== */

/** The Bloodline forfeit lifecycle — terminal state is `resolved`. */
export type ForfeitState = 'pending' | 'active' | 'unsettled' | 'resolved';

/** 1X2 prediction outcome (home win / draw / away win). */
export type Outcome1x2 = 'home' | 'draw' | 'away';

/** Evidence medium attached to a Hall of Shame entry. */
export type ProofKind = 'image' | 'video' | 'link';

/** Fixture lifecycle status (mirrors SQL `match_status`). */
export type MatchStatus = 'scheduled' | 'live' | 'final';

/* ===========================================================================
 * Core entities (one interface per table in §3)
 * ======================================================================== */

/** A registered player — `users` table. */
export interface User {
  id: string; // UUID
  username: string;
  display_name: string;
  elo_rating: number; // INTEGER, seeded at 1500
  total_points: number; // INTEGER season aggregate
  created_at: string; // ISO-8601 TIMESTAMPTZ
}

/** A World Cup 2026 fixture — `matches` table. */
export interface Match {
  id: string; // UUID
  ext_ref: string | null; // upstream feed id (nullable)
  home_team: string;
  away_team: string;
  group_label: string | null; // e.g. 'GROUP F'
  venue: string | null;
  kickoff_at: string; // ISO-8601 TIMESTAMPTZ
  /** GENERATED column: kickoff_at − 1 minute. Predictions lock at this instant. */
  lock_at: string; // ISO-8601 TIMESTAMPTZ
  status: MatchStatus;
  home_score: number | null; // SMALLINT, NULL until played
  away_score: number | null; // SMALLINT, NULL until played
  created_at: string; // ISO-8601 TIMESTAMPTZ
}

/** A user's 1X2 (+ optional exact-score) call on a match — `predictions` table. */
export interface Prediction {
  id: string; // UUID
  user_id: string; // → users.id
  match_id: string; // → matches.id
  outcome: Outcome1x2;
  exact_home: number | null; // SMALLINT, optional exact scoreline
  exact_away: number | null; // SMALLINT, optional exact scoreline
  is_locked: boolean;
  points_awarded: number | null; // NULL until the match is settled
  created_at: string; // ISO-8601 TIMESTAMPTZ
  updated_at: string; // ISO-8601 TIMESTAMPTZ
}

/** A "Bloodline" wager between two friends — `forfeits` table. */
export interface Forfeit {
  id: string; // UUID
  challenger_id: string; // → users.id
  opponent_id: string; // → users.id (CHECK: ≠ challenger_id)
  match_id: string | null; // → matches.id (nullable)
  stake: string; // the punishment on the line
  state: ForfeitState;
  loser_id: string | null; // → users.id (set on settle)
  // Lifecycle timestamps (UTC); each is NULL until its transition fires.
  created_at: string; // ISO-8601 TIMESTAMPTZ
  accepted_at: string | null;
  unsettled_at: string | null;
  resolved_at: string | null;
  // Timeout / nudge bookkeeping (durations elsewhere are metric SI seconds).
  nudge_count: number; // SMALLINT
  last_nudge_at: string | null;
}

/**
 * A Hall of Shame proof ledger entry enriched with tribunal vote tallies.
 *
 * The base columns mirror `hall_of_shame`; `up`, `down` and `net` are the
 * aggregated thumbs-up / thumbs-down counts joined from `shame_votes`
 * (net = up − down), exposed by `GET /api/hall` per §6.
 */
export interface HallEntry {
  id: string; // UUID, hall_of_shame.id
  forfeit_id: string; // → forfeits.id (UNIQUE)
  loser_id: string; // → users.id
  proof_url: string; // image/video/link evidence
  proof_kind: ProofKind;
  caption: string | null;
  verified: boolean; // true once the tribunal passes
  created_at: string; // ISO-8601 TIMESTAMPTZ
  // Aggregated tribunal tallies (joined from shame_votes).
  up: number; // count of +1 votes
  down: number; // count of −1 votes
  net: number; // up − down (net thumbs-up)
}

/* ===========================================================================
 * Derived / read-model shapes returned by aggregate endpoints (§6)
 * ======================================================================== */

/** A single row in a group standings table (GET /api/standings). */
export interface GroupStanding {
  group_label: string; // e.g. 'GROUP F'
  team: string; // team name
  played: number; // matches played
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number; // goals_for − goals_against
  points: number; // 3·won + drawn (tournament points)
}

/** A single row on the season leaderboard (GET /api/leaderboard). */
export interface LeaderboardRow {
  user_id: string; // → users.id
  username: string;
  display_name: string;
  elo_rating: number; // Elo ranking weight
  total_points: number; // season fantasy total
  predictions_made: number; // predictions placed this season (matches backend)
  rank: number; // 1-based standing position
}

/**
 * The aggregated dashboard payload returned by `GET /api/hub?user_id=:uuid`.
 * One round trip powers the entire Hub view (§6).
 */
export interface HubPayload {
  upcoming_matches: Match[];
  standings: GroupStanding[];
  active_forfeits: Forfeit[];
}
