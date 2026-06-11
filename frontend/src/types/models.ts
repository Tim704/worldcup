/**
 * models.ts
 * ----------------------------------------------------------------------------
 * TypeScript domain model for The Almanac Cup frontend (CONTRACT §6,
 * "Shared API types"). Field names stay in **snake_case** so the JSON from the
 * Node/Express server deserialises straight into these types with zero key
 * renaming on either side.
 *
 * Enum string-literal unions match the PostgreSQL enums verbatim (§3):
 *   match_status → 'scheduled' | 'live' | 'final'
 *   wager_state  → 'PENDING' | 'ACCEPTED' | 'RESOLVED_WON' | 'RESOLVED_LOST'
 *   wager_pick   → 'home' | 'draw' | 'away'
 *
 * Timestamps are ISO-8601 UTC strings (TIMESTAMPTZ serialised by the server);
 * the browser formats them locally via src/lib/datetime.ts. Durations anywhere
 * in the app are metric SI seconds.
 * ----------------------------------------------------------------------------
 */

/* ===========================================================================
 * Enum unions
 * ======================================================================== */

/** Fixture lifecycle status (SQL `match_status`). 'final' only via /score. */
export type MatchStatus = 'scheduled' | 'live' | 'final';

/** Wager lifecycle (SQL `wager_state`) — from the CREATOR's perspective. */
export type WagerState = 'PENDING' | 'ACCEPTED' | 'RESOLVED_WON' | 'RESOLVED_LOST';

/** The side a wager backs (SQL `wager_pick`). */
export type WagerPick = 'home' | 'draw' | 'away';

/* ===========================================================================
 * Core entities
 * ======================================================================== */

/** A registered player — passwordless, upserted by username on login. */
export interface User {
  id: string; // UUID
  username: string;
  display_name: string;
  is_admin: boolean;
  total_points: number; // season total under the 5/2/0 scheme
  created_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
}

/** A World Cup 2026 fixture — `matches` table. */
export interface Match {
  id: string; // UUID
  ext_ref: string | null; // ingest idempotency key
  home_team: string;
  away_team: string;
  group_label: string | null; // e.g. 'GROUP F'
  venue: string | null;
  kickoff_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  /** GENERATED column: kickoff_at − 60 s. Predictions & wagers lock here. */
  lock_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  status: MatchStatus;
  home_score: number | null; // SMALLINT, NULL until scored
  away_score: number | null; // SMALLINT, NULL until scored
  is_featured: boolean; // the "Main Event" flag
}

/** A user's exact-score call on a match — `predictions` table. */
export interface Prediction {
  id: string; // UUID
  user_id: string; // → users.id
  match_id: string; // → matches.id
  pred_home: number; // SMALLINT 0–20
  pred_away: number; // SMALLINT 0–20
  points_awarded: number | null; // NULL until the match is final (then 5/2/0)
  created_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  updated_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
}

/** A match joined with the caller's own prediction (when authenticated). */
export interface MatchWithMine extends Match {
  my_prediction: Prediction | null;
}

/** A prediction revealed post-lock, joined with its author's identity. */
export interface PredictionWithUser extends Prediction {
  username: string;
  display_name: string;
}

/** One row of the season leaderboard (GET /api/leaderboard, DENSE_RANK). */
export interface LeaderboardRow {
  rank: number;
  user_id: string; // → users.id
  username: string;
  display_name: string;
  total_points: number;
  exact_hits: number; // settled predictions worth 5
  outcome_hits: number; // settled predictions worth 2
  predictions_settled: number; // predictions with points_awarded NOT NULL
}

/* ===========================================================================
 * Tournament Predictor (Contract §11)
 * ======================================================================== */

/** group_picks: per group letter (A–L), predicted finishing order (index 0 = winner). */
export type BracketGroupPicks = Record<string, string[]>;

/** third_picks: up to 8 group letters whose 3rd-placed team takes a best-third berth. */
export type BracketThirdPicks = string[];

/** bracket_picks: picked winner per knockout slot, keyed by FIFA match number ('M73'…'M104'). */
export type BracketSlotPicks = Record<string, string>;

/** A user's whole-tournament prophecy — `bracket_predictions` table. */
export interface BracketPrediction {
  id: string; // UUID
  user_id: string; // → users.id
  group_picks: BracketGroupPicks;
  third_picks: BracketThirdPicks;
  bracket_picks: BracketSlotPicks;
  created_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  updated_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
}

/** A lightweight public identity (no points/admin) — used when browsing brackets. */
export interface PublicUser {
  id: string; // UUID
  username: string;
  display_name: string;
}

/** GET /api/bracket/:userId — a player plus their prophecy (null when none on file). */
export interface BracketOfUser {
  user: PublicUser;
  bracket: BracketPrediction | null;
}

/**
 * A wager as the API serves it: the `wagers` row joined with both parties'
 * usernames and the underlying match info (GET /api/wagers).
 */
export interface WagerView {
  id: string; // UUID
  match_id: string; // → matches.id
  creator_id: string; // → users.id
  acceptor_id: string | null; // → users.id, NULL while PENDING
  pick: WagerPick;
  margin: number | null; // "wins by ≥ N goals", 1–10, non-draw picks only
  claim: string; // the human boast, 3–140 chars
  forfeit: string | null; // what the loser owes; set on accept
  state: WagerState;
  winner_id: string | null; // set on settlement
  loser_id: string | null; // set on settlement
  created_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  accepted_at: string | null;
  resolved_at: string | null;
  // Joined usernames for display.
  creator_username: string;
  acceptor_username: string | null;
  winner_username: string | null;
  loser_username: string | null;
  // Joined match info.
  home_team: string;
  away_team: string;
  kickoff_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  lock_at: string; // ISO-8601 TIMESTAMPTZ (UTC)
  match_status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
}
