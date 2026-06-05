/**
 * client.ts
 * ----------------------------------------------------------------------------
 * Thin `fetch` wrapper around the World Cup 2026 Fantasy Hub backend (§6).
 *
 * Design goals:
 *   1. Conform to the exact route paths and request/response shapes in
 *      CONTRACT §6 (base path `/api`).
 *   2. Be resilient with NO backend running: every call first attempts the real
 *      endpoint and, on a *network/transport* failure (backend unreachable),
 *      transparently returns realistic MOCK data so every view renders during
 *      local design work. HTTP-level errors (4xx/5xx) are still surfaced so the
 *      UI can react to e.g. a 409 lock rejection.
 *
 * Base URL: `import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api'`
 * (the `VITE_API_BASE` env var name is fixed by §9).
 *
 * All durations referenced here are metric SI seconds; timestamps are ISO-8601.
 * ----------------------------------------------------------------------------
 */

import type {
  Forfeit,
  ForfeitState,
  HallEntry,
  HubPayload,
  Match,
  Outcome1x2,
  Prediction,
  ProofKind,
} from '../types/models';

/* ===========================================================================
 * Configuration
 * ======================================================================== */

/** Resolved API base path. `VITE_API_BASE` overrides the localhost default. */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api';

/* ===========================================================================
 * Low-level request helper
 * ======================================================================== */

/** Options accepted by the internal request helper. */
interface RequestOptions {
  method?: 'GET' | 'POST';
  /** JSON body for POST requests; serialised with JSON.stringify. */
  body?: unknown;
  /** Query parameters appended to the path (undefined values are skipped). */
  query?: Record<string, string | undefined>;
}

/**
 * Sentinel error thrown when the backend is reachable but answers with a
 * non-2xx status. Callers (or the mock-fallback layer) can distinguish a real
 * HTTP error from a transport failure by `instanceof ApiError`.
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

/**
 * Perform a JSON request against the API.
 *
 * - On a successful 2xx response, resolves with the parsed JSON as `T`.
 * - On a non-2xx response, throws an {@link ApiError} (the backend is up but
 *   rejected the request — propagate so the UI can handle it, e.g. 409 locks).
 * - On a transport failure (DNS/connection refused — backend down), the
 *   underlying `fetch` rejects with a `TypeError`; we re-throw it so the public
 *   wrapper can swap in mock data.
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

  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Backend answered with an error envelope { error: { code, message } } (§6).
    let code = 'http_error';
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (payload.error?.code) {
        code = payload.error.code;
      }
      if (payload.error?.message) {
        message = payload.error.message;
      }
    } catch {
      // Body was not JSON; keep the generic message.
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

/**
 * Wrap a live request so that a transport failure (backend unreachable) falls
 * back to mock data. An {@link ApiError} (backend up but rejected) is rethrown
 * so the UI still sees real HTTP errors (e.g. a 409 prediction lock).
 *
 * @param live  Thunk performing the real request.
 * @param mock  Thunk producing realistic fallback data.
 */
async function withMockFallback<T>(
  live: () => Promise<T>,
  mock: () => T,
): Promise<T> {
  try {
    return await live();
  } catch (err) {
    if (err instanceof ApiError) {
      // Backend is alive and deliberately rejected — surface the real error.
      throw err;
    }
    // Transport-level failure (offline / no backend) → render with mock data.
    // eslint-disable-next-line no-console
    console.warn(
      `[api] backend unreachable — serving mock data for this call:`,
      err,
    );
    return mock();
  }
}

/* ===========================================================================
 * Mock data — realistic fixtures so the SPA is fully explorable offline.
 * Identifiers are stable UUID-shaped strings; timestamps are computed relative
 * to "now" so countdowns and "upcoming" filters behave naturally.
 * ======================================================================== */

/** Produce an ISO-8601 timestamp `offsetSecs` seconds from now (metric SI). */
function isoFromNow(offsetSecs: number): string {
  return new Date(Date.now() + offsetSecs * 1000).toISOString();
}

// Stable mock user ids reused across mock entities.
const MOCK_USERS = {
  raya: '11111111-1111-1111-1111-111111111111',
  diego: '22222222-2222-2222-2222-222222222222',
  amara: '33333333-3333-3333-3333-333333333333',
  kenji: '44444444-4444-4444-4444-444444444444',
} as const;

/** Build a mock fixture; `kickoffOffsetSecs` is relative to now (SI seconds). */
function mockMatch(
  id: string,
  home: string,
  away: string,
  group: string,
  venue: string,
  kickoffOffsetSecs: number,
  status: Match['status'] = 'scheduled',
  homeScore: number | null = null,
  awayScore: number | null = null,
): Match {
  return {
    id,
    ext_ref: `FX-${id.slice(0, 4).toUpperCase()}`,
    home_team: home,
    away_team: away,
    group_label: group,
    venue,
    kickoff_at: isoFromNow(kickoffOffsetSecs),
    // lock_at mirrors the GENERATED column: kickoff − 60 s.
    lock_at: isoFromNow(kickoffOffsetSecs - 60),
    status,
    home_score: homeScore,
    away_score: awayScore,
    created_at: isoFromNow(-86_400),
  };
}

/** The canonical mock fixture list (kickoffs spread across the next ~30 h). */
const MOCK_MATCHES: Match[] = [
  mockMatch('aaaa1111-0000-0000-0000-000000000001', 'Argentina', 'Mexico', 'GROUP F', 'Estadio Azteca, Mexico City', 8_040),
  mockMatch('aaaa1111-0000-0000-0000-000000000002', 'Brazil', 'Croatia', 'GROUP H', 'MetLife Stadium, New York/NJ', -4_020, 'live', 1, 0),
  mockMatch('aaaa1111-0000-0000-0000-000000000003', 'United States', 'Netherlands', 'GROUP D', 'SoFi Stadium, Los Angeles', 17_700),
  mockMatch('aaaa1111-0000-0000-0000-000000000004', 'France', 'Morocco', 'GROUP C', 'AT&T Stadium, Dallas', 28_200),
  mockMatch('aaaa1111-0000-0000-0000-000000000005', 'England', 'Senegal', 'GROUP E', 'Mercedes-Benz Stadium, Atlanta', 79_500),
  mockMatch('aaaa1111-0000-0000-0000-000000000006', 'Spain', 'Japan', 'GROUP G', 'Hard Rock Stadium, Miami', 89_400),
  mockMatch('aaaa1111-0000-0000-0000-000000000007', 'Portugal', 'Uruguay', 'GROUP I', 'Lumen Field, Seattle', 109_200),
];

/** Mock group standings (two illustrative groups, ranked by points). */
const MOCK_STANDINGS = [
  { group_label: 'GROUP F', team: 'Argentina', played: 2, won: 2, drawn: 0, lost: 0, goals_for: 5, goals_against: 1, goal_difference: 4, points: 6 },
  { group_label: 'GROUP F', team: 'Mexico', played: 2, won: 1, drawn: 0, lost: 1, goals_for: 3, goals_against: 3, goal_difference: 0, points: 3 },
  { group_label: 'GROUP F', team: 'Poland', played: 2, won: 1, drawn: 0, lost: 1, goals_for: 2, goals_against: 3, goal_difference: -1, points: 3 },
  { group_label: 'GROUP F', team: 'Saudi Arabia', played: 2, won: 0, drawn: 0, lost: 2, goals_for: 1, goals_against: 4, goal_difference: -3, points: 0 },
  { group_label: 'GROUP H', team: 'Brazil', played: 2, won: 1, drawn: 1, lost: 0, goals_for: 4, goals_against: 2, goal_difference: 2, points: 4 },
  { group_label: 'GROUP H', team: 'Croatia', played: 2, won: 1, drawn: 1, lost: 0, goals_for: 3, goals_against: 2, goal_difference: 1, points: 4 },
  { group_label: 'GROUP H', team: 'Cameroon', played: 2, won: 0, drawn: 1, lost: 1, goals_for: 2, goals_against: 3, goal_difference: -1, points: 1 },
  { group_label: 'GROUP H', team: 'Serbia', played: 2, won: 0, drawn: 1, lost: 1, goals_for: 1, goals_against: 3, goal_difference: -2, points: 1 },
];

/** Build a mock forfeit row in a given lifecycle state. */
function mockForfeit(
  id: string,
  challenger: string,
  opponent: string,
  matchId: string | null,
  stake: string,
  state: ForfeitState,
  loser: string | null = null,
): Forfeit {
  return {
    id,
    challenger_id: challenger,
    opponent_id: opponent,
    match_id: matchId,
    stake,
    state,
    loser_id: loser,
    created_at: isoFromNow(-43_200),
    accepted_at: state === 'pending' ? null : isoFromNow(-39_600),
    unsettled_at: state === 'unsettled' || state === 'resolved' ? isoFromNow(-7_200) : null,
    resolved_at: state === 'resolved' ? isoFromNow(-3_600) : null,
    nudge_count: state === 'unsettled' ? 1 : 0,
    last_nudge_at: state === 'unsettled' ? isoFromNow(-1_800) : null,
  };
}

/** Mock forfeits spanning all four Bloodline states. */
const MOCK_FORFEITS: Forfeit[] = [
  mockForfeit('bbbb2222-0000-0000-0000-000000000001', MOCK_USERS.raya, MOCK_USERS.diego, MOCK_MATCHES[0].id, 'Wear the rival jersey for a full workday', 'pending'),
  mockForfeit('bbbb2222-0000-0000-0000-000000000002', MOCK_USERS.amara, MOCK_USERS.kenji, MOCK_MATCHES[2].id, 'Sing the loser’s anthem on video', 'active'),
  mockForfeit('bbbb2222-0000-0000-0000-000000000003', MOCK_USERS.diego, MOCK_USERS.amara, MOCK_MATCHES[1].id, 'Buy the group dinner — no excuses', 'unsettled', MOCK_USERS.amara),
  mockForfeit('bbbb2222-0000-0000-0000-000000000004', MOCK_USERS.kenji, MOCK_USERS.raya, null, 'Dye hair in the winner’s colours', 'resolved', MOCK_USERS.kenji),
];

/** Mock Hall of Shame entries with tribunal tallies. */
const MOCK_HALL: HallEntry[] = [
  {
    id: 'cccc3333-0000-0000-0000-000000000001',
    forfeit_id: MOCK_FORFEITS[3].id,
    loser_id: MOCK_USERS.kenji,
    proof_url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=640',
    proof_kind: 'image',
    caption: 'Hair dyed full vermillion. A deal is a deal.',
    verified: true,
    created_at: isoFromNow(-3_600),
    up: 9,
    down: 2,
    net: 7,
  },
  {
    id: 'cccc3333-0000-0000-0000-000000000002',
    forfeit_id: MOCK_FORFEITS[2].id,
    loser_id: MOCK_USERS.amara,
    proof_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    proof_kind: 'video',
    caption: 'Anthem performed, badly. The tribunal will decide.',
    verified: false,
    created_at: isoFromNow(-1_200),
    up: 2,
    down: 1,
    net: 1,
  },
  {
    id: 'cccc3333-0000-0000-0000-000000000003',
    forfeit_id: 'bbbb2222-0000-0000-0000-000000000099',
    loser_id: MOCK_USERS.diego,
    proof_url: 'https://example.com/receipt-dinner-proof',
    proof_kind: 'link',
    caption: 'Receipt for the entire group dinner attached.',
    verified: false,
    created_at: isoFromNow(-600),
    up: 1,
    down: 0,
    net: 1,
  },
];

/* ===========================================================================
 * Public API surface — one function per endpoint group used by the views.
 * ======================================================================== */

/** GET /api/hub?user_id=:uuid → aggregated dashboard payload. */
export function getHub(userId: string): Promise<HubPayload> {
  return withMockFallback(
    () => request<HubPayload>('/hub', { query: { user_id: userId } }),
    () => ({
      upcoming_matches: MOCK_MATCHES.filter((m) => m.status === 'scheduled'),
      standings: MOCK_STANDINGS,
      active_forfeits: MOCK_FORFEITS.filter((f) => f.state === 'active' || f.state === 'pending'),
    }),
  );
}

/** GET /api/matches → all fixtures. */
export function listMatches(): Promise<Match[]> {
  return withMockFallback(
    () => request<Match[]>('/matches'),
    () => MOCK_MATCHES,
  );
}

/** GET /api/forfeits?user_id=:uuid&state= → forfeits, optionally filtered. */
export function listForfeits(
  userId: string,
  state?: ForfeitState,
): Promise<Forfeit[]> {
  return withMockFallback(
    () => request<Forfeit[]>('/forfeits', { query: { user_id: userId, state } }),
    () => (state ? MOCK_FORFEITS.filter((f) => f.state === state) : MOCK_FORFEITS),
  );
}

/** Payload for creating a new forfeit challenge (POST /api/forfeits, §6). */
export interface CreateForfeitInput {
  challenger_id: string;
  opponent_id: string;
  match_id?: string;
  stake: string;
}

/** POST /api/forfeits → newly created Forfeit in the `pending` state. */
export function createForfeit(input: CreateForfeitInput): Promise<Forfeit> {
  return withMockFallback(
    () => request<Forfeit>('/forfeits', { method: 'POST', body: input }),
    () =>
      mockForfeit(
        `bbbb2222-0000-0000-0000-${Date.now().toString().slice(-12).padStart(12, '0')}`,
        input.challenger_id,
        input.opponent_id,
        input.match_id ?? null,
        input.stake,
        'pending',
      ),
  );
}

/** POST /api/forfeits/:id/accept → Forfeit transitioned to `active`. */
export function acceptForfeit(id: string): Promise<Forfeit> {
  return withMockFallback(
    () => request<Forfeit>(`/forfeits/${id}/accept`, { method: 'POST' }),
    () => ({ ...mockForfeit(id, MOCK_USERS.raya, MOCK_USERS.diego, null, 'Accepted challenge', 'active') }),
  );
}

/** POST /api/forfeits/:id/decline → Forfeit transitioned to `resolved`. */
export function declineForfeit(id: string): Promise<Forfeit> {
  return withMockFallback(
    () => request<Forfeit>(`/forfeits/${id}/decline`, { method: 'POST' }),
    () => ({ ...mockForfeit(id, MOCK_USERS.raya, MOCK_USERS.diego, null, 'Declined challenge', 'resolved') }),
  );
}

/** Payload for submitting punishment proof (POST /api/forfeits/:id/proof). */
export interface SubmitProofInput {
  proof_url: string;
  proof_kind: ProofKind;
  caption?: string;
}

/**
 * POST /api/forfeits/:id/proof → Forfeit stays `unsettled` and a Hall of Shame
 * row is created (verified=false). Returns the resulting HallEntry for the UI.
 */
export function submitProof(
  forfeitId: string,
  input: SubmitProofInput,
): Promise<HallEntry> {
  return withMockFallback(
    () => request<HallEntry>(`/forfeits/${forfeitId}/proof`, { method: 'POST', body: input }),
    () => ({
      id: `cccc3333-0000-0000-0000-${Date.now().toString().slice(-12).padStart(12, '0')}`,
      forfeit_id: forfeitId,
      loser_id: MOCK_USERS.diego,
      proof_url: input.proof_url,
      proof_kind: input.proof_kind,
      caption: input.caption ?? null,
      verified: false,
      created_at: isoFromNow(0),
      up: 0,
      down: 0,
      net: 0,
    }),
  );
}

/** GET /api/hall → Hall of Shame entries with vote tallies. */
export function listHall(): Promise<HallEntry[]> {
  return withMockFallback(
    () => request<HallEntry[]>('/hall'),
    () => MOCK_HALL,
  );
}

/**
 * POST /api/hall/:entryId/vote → cast a tribunal vote (+1 up / −1 down).
 * Returns the updated entry (tallies may flip `verified` and resolve the
 * forfeit when the net threshold is reached, per §4/§6).
 */
export function voteShame(
  entryId: string,
  voterId: string,
  vote: 1 | -1,
): Promise<HallEntry> {
  return withMockFallback(
    () =>
      request<HallEntry>(`/hall/${entryId}/vote`, {
        method: 'POST',
        body: { voter_id: voterId, vote },
      }),
    () => {
      // Optimistic local tally update for the offline mock.
      const base =
        MOCK_HALL.find((e) => e.id === entryId) ?? MOCK_HALL[0];
      const up = base.up + (vote === 1 ? 1 : 0);
      const down = base.down + (vote === -1 ? 1 : 0);
      const net = up - down;
      // TRIBUNAL_NET_VOTES = 3 (§4): net ≥ 3 flips verified true.
      return { ...base, up, down, net, verified: net >= 3 };
    },
  );
}

/* ===========================================================================
 * Predictions surface (used by future wiring; included for §6 completeness).
 * ======================================================================== */

/** Payload for upserting a prediction (POST /api/predictions, §6). */
export interface UpsertPredictionInput {
  user_id: string;
  match_id: string;
  outcome: Outcome1x2;
  exact_home?: number;
  exact_away?: number;
}

/**
 * GET /api/predictions?user_id=:uuid → a user's predictions.
 * Mock returns an empty slate (the Predict view self-seeds its own demo state).
 */
export function listPredictions(userId: string): Promise<Prediction[]> {
  return withMockFallback(
    () => request<Prediction[]>('/predictions', { query: { user_id: userId } }),
    () => [],
  );
}
