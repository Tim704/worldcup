/**
 * client.ts
 * ----------------------------------------------------------------------------
 * Typed `fetch` wrapper around The Almanac Cup API (CONTRACT §6, base `/api`).
 *
 * Responsibilities:
 *   1. Resolve the base URL: `import.meta.env.VITE_API_BASE || '/api'`
 *      ('/api' = same-origin via the nginx proxy in prod / the Vite dev proxy).
 *   2. Inject `Authorization: Bearer <token>` on every request, reading the
 *      JWT from localStorage under the fixed key `almanac_token`.
 *   3. Unwrap the server's error envelope
 *      `{ "error": { "code": "...", "message": "..." } }`
 *      into a typed {@link ApiError} so views can branch on `status`/`code`
 *      (e.g. 409 MATCH_LOCKED, 401 UNAUTHENTICATED).
 *
 * One typed method per contract route — nothing more, nothing less. All
 * durations in this module's docs are metric SI seconds; timestamps are
 * ISO-8601 UTC strings.
 * ----------------------------------------------------------------------------
 */

import type {
  BracketGroupPicks,
  BracketOfUser,
  BracketPrediction,
  BracketSlotPicks,
  BracketThirdPicks,
  LeaderboardRow,
  Match,
  MatchStatus,
  MatchWithMine,
  Prediction,
  PredictionWithUser,
  User,
  WagerPick,
  WagerState,
  WagerView,
} from '../types/models';

/* ===========================================================================
 * Configuration & token storage
 * ======================================================================== */

/** Resolved API base path. `VITE_API_BASE` (CONTRACT §8) overrides '/api'. */
export const API_BASE: string = import.meta.env.VITE_API_BASE || '/api';

/** The fixed localStorage key for the session JWT (CONTRACT §6). */
const TOKEN_KEY = 'almanac_token';

/** Read the persisted JWT, or null when signed out. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Persist the JWT after a successful login. */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Drop the JWT (sign-out, or a 401 during boot re-validation). */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/* ===========================================================================
 * Errors
 * ======================================================================== */

/**
 * Typed error raised when the API answers with a non-2xx status. Carries the
 * HTTP status plus the contract error code (`VALIDATION`, `UNAUTHENTICATED`,
 * `FORBIDDEN`, `NOT_FOUND`, `MATCH_LOCKED`, `WAGER_CONFLICT`, `INTERNAL`).
 * Transport failures (server unreachable) reject with the browser's native
 * TypeError instead — callers can distinguish via `instanceof ApiError`.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/* ===========================================================================
 * Low-level request helper
 * ======================================================================== */

/** Options accepted by the internal request helper. */
interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** JSON body for POST requests; serialised with JSON.stringify. */
  body?: unknown;
  /** Query parameters appended to the path (undefined values are skipped). */
  query?: Record<string, string | undefined>;
}

/**
 * Perform a JSON request against the API.
 *
 * - 2xx  → resolves with the parsed JSON as `T`.
 * - non-2xx → throws {@link ApiError}, populated from the error envelope
 *   (falling back to a generic INTERNAL error when the body is not JSON).
 * - transport failure → the native fetch rejection propagates unchanged.
 */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = opts;

  // Build the query string, skipping undefined values.
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.append(key, value);
      }
    }
    const qs = params.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Assemble headers: JSON content type when a body ships, Bearer token when
  // a session exists (localStorage 'almanac_token').
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Unwrap the contract error envelope { error: { code, message } }.
    let code = 'INTERNAL';
    let message = `request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (payload.error?.code) code = payload.error.code;
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Body was not JSON; keep the generic message.
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

/* ===========================================================================
 * Typed API surface — one method per contract route (§6).
 * ======================================================================== */

export const api = {
  /** GET /api/health → { status: 'ok', uptime_secs } (uptime in SI seconds). */
  health(): Promise<{ status: string; uptime_secs: number }> {
    return request('/health');
  },

  /** POST /api/auth/login {username, display_name?} → { token, user }. */
  login(username: string, displayName?: string): Promise<{ token: string; user: User }> {
    const body: { username: string; display_name?: string } = { username };
    if (displayName !== undefined) body.display_name = displayName;
    return request('/auth/login', { method: 'POST', body });
  },

  /** GET /api/auth/me (auth) → the signed-in User (token re-validation). */
  me(): Promise<User> {
    return request('/auth/me');
  },

  /** GET /api/matches (opt auth) → all fixtures, kickoff_at ASC, with my_prediction when authed. */
  listMatches(): Promise<MatchWithMine[]> {
    return request('/matches');
  },

  /** GET /api/matches/next (opt auth) → first match with lock_at > now (or null). */
  nextMatch(): Promise<{ match: MatchWithMine | null }> {
    return request('/matches/next');
  },

  /** GET /api/matches/:id (opt auth) → a single fixture. */
  getMatch(id: string): Promise<MatchWithMine> {
    return request(`/matches/${id}`);
  },

  /**
   * GET /api/matches/:id/predictions → everyone's calls, ONLY once
   * now ≥ lock_at (the server answers 409 MATCH_LOCKED before that —
   * picks are secret until lock).
   */
  matchPredictions(id: string): Promise<PredictionWithUser[]> {
    return request(`/matches/${id}/predictions`);
  },

  /**
   * POST /api/predictions (auth) {match_id, pred_home, pred_away} →
   * upserted Prediction. 409 MATCH_LOCKED once now ≥ lock_at; scores 0–20.
   */
  upsertPrediction(input: {
    match_id: string;
    pred_home: number;
    pred_away: number;
  }): Promise<Prediction> {
    return request('/predictions', { method: 'POST', body: input });
  },

  /** GET /api/predictions/mine (auth) → all of my predictions. */
  myPredictions(): Promise<Prediction[]> {
    return request('/predictions/mine');
  },

  /** GET /api/bracket (auth) → { bracket } — my prophecy, null when none yet. */
  getBracket(): Promise<{ bracket: BracketPrediction | null }> {
    return request('/bracket');
  },

  /**
   * GET /api/bracket/:userId (auth) → { user, bracket } — browse another
   * player's tree (read-only; their `bracket` is null when none on file).
   */
  getUserBracket(userId: string): Promise<BracketOfUser> {
    return request(`/bracket/${userId}`);
  },

  /**
   * POST /api/bracket (auth) {group_picks, third_picks, bracket_picks} →
   * the upserted BracketPrediction (one prophecy per user, replaced whole).
   */
  saveBracket(input: {
    group_picks: BracketGroupPicks;
    third_picks: BracketThirdPicks;
    bracket_picks: BracketSlotPicks;
  }): Promise<BracketPrediction> {
    return request('/bracket', { method: 'POST', body: input });
  },

  /** GET /api/leaderboard → ranked season table (DENSE_RANK, one query). */
  leaderboard(): Promise<LeaderboardRow[]> {
    return request('/leaderboard');
  },

  /** GET /api/wagers?state=&user_id= → WagerView[] newest first. */
  listWagers(filters: { state?: WagerState; user_id?: string } = {}): Promise<WagerView[]> {
    return request('/wagers', { query: { state: filters.state, user_id: filters.user_id } });
  },

  /** POST /api/wagers (auth) {match_id, pick, margin?, claim} → new WagerView. */
  createWager(input: {
    match_id: string;
    pick: WagerPick;
    margin?: number;
    claim: string;
  }): Promise<WagerView> {
    return request('/wagers', { method: 'POST', body: input });
  },

  /** POST /api/wagers/:id/accept (auth) {forfeit} → the ACCEPTED WagerView. */
  acceptWager(id: string, forfeit: string): Promise<WagerView> {
    return request(`/wagers/${id}/accept`, { method: 'POST', body: { forfeit } });
  },

  /** DELETE /api/wagers/:id (auth) — creator only, PENDING only. */
  deleteWager(id: string): Promise<{ deleted: boolean }> {
    return request(`/wagers/${id}`, { method: 'DELETE' });
  },

  /**
   * POST /api/admin/matches/:id/score (admin) {home_score, away_score} →
   * runs the full settlement pipeline (scores 5/2/0, totals, wagers) in one
   * transaction; idempotent on re-submission of corrected scores.
   */
  adminScore(
    id: string,
    home_score: number,
    away_score: number,
  ): Promise<{ match: Match; predictions_scored: number; wagers_resolved: number }> {
    return request(`/admin/matches/${id}/score`, {
      method: 'POST',
      body: { home_score, away_score },
    });
  },

  /** POST /api/admin/matches/:id/feature (admin) {is_featured} → Match. */
  adminFeature(id: string, is_featured: boolean): Promise<Match> {
    return request(`/admin/matches/${id}/feature`, { method: 'POST', body: { is_featured } });
  },

  /**
   * POST /api/admin/matches/:id/status (admin) {status} → Match.
   * Only 'scheduled' | 'live' here — 'final' is reachable solely via /score.
   */
  adminStatus(id: string, status: Exclude<MatchStatus, 'final'>): Promise<Match> {
    return request(`/admin/matches/${id}/status`, { method: 'POST', body: { status } });
  },
};
