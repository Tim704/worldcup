/**
 * types.ts — shared API types (Contract §6, "Shared API types").
 *
 * These interfaces mirror the wire format EXACTLY: snake_case field names on
 * both sides, timestamps as ISO-8601 UTC strings (TIMESTAMPTZ serialised),
 * enum string literals matching the Postgres enum values verbatim.
 *
 * Numeric SQL aggregates (COUNT / SUM / DENSE_RANK) come back from `pg` as
 * strings (int8) — route handlers cast them to Number before responding, so
 * everything declared `number` here really is a JSON number on the wire.
 */

/** matches.status — Postgres enum `match_status`. */
export type MatchStatus = 'scheduled' | 'live' | 'final';

/** wagers.state — Postgres enum `wager_state` (creator's perspective). */
export type WagerState = 'PENDING' | 'ACCEPTED' | 'RESOLVED_WON' | 'RESOLVED_LOST';

/** wagers.pick — Postgres enum `wager_pick`. */
export type WagerPick = 'home' | 'draw' | 'away';

export interface User {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  total_points: number;
  created_at: string; // ISO-8601 UTC
}

export interface Match {
  id: string;
  ext_ref: string | null;
  home_team: string;
  away_team: string;
  group_label: string | null;
  venue: string | null;
  kickoff_at: string; // ISO-8601 UTC
  lock_at: string;    // ISO-8601 UTC — kickoff_at minus 60 s (generated column)
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  is_featured: boolean;
}

/** Match plus the signed-in caller's own prediction (null when anonymous / none). */
export type MatchWithMine = Match & { my_prediction: Prediction | null };

export interface Prediction {
  id: string;
  user_id: string;
  match_id: string;
  pred_home: number;
  pred_away: number;
  points_awarded: number | null; // NULL until the match is final
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
}

/** Prediction joined with its author — only served once a match is locked. */
export type PredictionWithUser = Prediction & { username: string; display_name: string };

export interface LeaderboardRow {
  rank: number; // DENSE_RANK() over total_points DESC
  user_id: string;
  username: string;
  display_name: string;
  total_points: number;
  exact_hits: number;          // predictions worth 5
  outcome_hits: number;        // predictions worth 2
  predictions_settled: number; // predictions with points_awarded NOT NULL
}

/** Wager joined with usernames + match info — the marketplace view. */
export interface WagerView {
  id: string;
  match_id: string;
  creator_id: string;
  acceptor_id: string | null;
  pick: WagerPick;
  margin: number | null;
  claim: string;
  forfeit: string | null;
  state: WagerState;
  winner_id: string | null;
  loser_id: string | null;
  created_at: string;          // ISO-8601 UTC
  accepted_at: string | null;  // ISO-8601 UTC
  resolved_at: string | null;  // ISO-8601 UTC
  creator_username: string;
  acceptor_username: string | null;
  winner_username: string | null;
  loser_username: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;          // ISO-8601 UTC
  lock_at: string;             // ISO-8601 UTC
  match_status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
}

/* ==========================================================================
 * SQL-boundary row mappers.
 *
 * `pg` hands rows back as loosely-typed objects: TIMESTAMPTZ → JS Date,
 * int8 aggregates (COUNT / SUM / DENSE_RANK) → string, smallint/int4 →
 * number. These mappers are the ONE place that mess is normalised into the
 * wire types above — `any` is quarantined here per Contract §10 ("no any
 * unless quarantined at the SQL boundary with a typed cast").
 * ======================================================================== */

/** A raw `pg` row — the sanctioned `any` quarantine zone. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqlRow = Record<string, any>;

/** TIMESTAMPTZ → ISO-8601 UTC string. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Nullable TIMESTAMPTZ → ISO-8601 UTC string | null. */
export function isoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/** Nullable numeric (possibly an int8 string from pg) → number | null. */
export function numOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** users row → User. */
export function mapUserRow(r: SqlRow): User {
  return {
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    is_admin: r.is_admin,
    total_points: Number(r.total_points),
    created_at: iso(r.created_at),
  };
}

/** matches row → Match (drops DB-only columns like created_at). */
export function mapMatchRow(r: SqlRow): Match {
  return {
    id: r.id,
    ext_ref: r.ext_ref ?? null,
    home_team: r.home_team,
    away_team: r.away_team,
    group_label: r.group_label ?? null,
    venue: r.venue ?? null,
    kickoff_at: iso(r.kickoff_at),
    lock_at: iso(r.lock_at),
    status: r.status,
    home_score: numOrNull(r.home_score),
    away_score: numOrNull(r.away_score),
    is_featured: r.is_featured,
  };
}

/** predictions row → Prediction. */
export function mapPredictionRow(r: SqlRow): Prediction {
  return {
    id: r.id,
    user_id: r.user_id,
    match_id: r.match_id,
    pred_home: Number(r.pred_home),
    pred_away: Number(r.pred_away),
    points_awarded: numOrNull(r.points_awarded),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** leaderboard query row → LeaderboardRow (int8 aggregates → Number). */
export function mapLeaderboardRow(r: SqlRow): LeaderboardRow {
  return {
    rank: Number(r.rank),
    user_id: r.user_id,
    username: r.username,
    display_name: r.display_name,
    total_points: Number(r.total_points),
    exact_hits: Number(r.exact_hits),
    outcome_hits: Number(r.outcome_hits),
    predictions_settled: Number(r.predictions_settled),
  };
}

/** joined wager-view query row → WagerView. */
export function mapWagerViewRow(r: SqlRow): WagerView {
  return {
    id: r.id,
    match_id: r.match_id,
    creator_id: r.creator_id,
    acceptor_id: r.acceptor_id ?? null,
    pick: r.pick,
    margin: numOrNull(r.margin),
    claim: r.claim,
    forfeit: r.forfeit ?? null,
    state: r.state,
    winner_id: r.winner_id ?? null,
    loser_id: r.loser_id ?? null,
    created_at: iso(r.created_at),
    accepted_at: isoOrNull(r.accepted_at),
    resolved_at: isoOrNull(r.resolved_at),
    creator_username: r.creator_username,
    acceptor_username: r.acceptor_username ?? null,
    winner_username: r.winner_username ?? null,
    loser_username: r.loser_username ?? null,
    home_team: r.home_team,
    away_team: r.away_team,
    kickoff_at: iso(r.kickoff_at),
    lock_at: iso(r.lock_at),
    match_status: r.match_status,
    home_score: numOrNull(r.home_score),
    away_score: numOrNull(r.away_score),
  };
}
