/**
 * liveScores.ts — automatic live scores + full-time settlement (Contract §4).
 *
 * Polls football-data.org for the World Cup's matches and, for every fixture we
 * already hold (matched by the ingest's `ext_ref`), keeps the score live and
 * settles it the moment it finishes — so the admin never has to enter a result
 * by hand:
 *
 *   - IN_PLAY / PAUSED  → write the running score, status 'live' (display only);
 *   - FINISHED / AWARDED → run the shared settleMatch() pipeline ONCE (5/2/0
 *     points, season totals, wagers), then never touch the row again;
 *   - everything else (SCHEDULED, POSTPONED, …) is left untouched.
 *
 * Disabled when FOOTBALL_DATA_TOKEN is unset (e.g. local dev), so the API runs
 * fine without it. Free-tier friendly: ONE request per poll (default 60 s) for
 * the whole competition — well under football-data's 10 req/min free limit.
 */
import { pool } from '../db.js';
import { settleMatch } from './settle.js';

/** How a football-data `status` maps onto our match model. */
export type FeedState = 'pending' | 'live' | 'final';

/**
 * Classify a football-data status string. Only IN_PLAY/PAUSED count as live and
 * only FINISHED/AWARDED as final; every other status (SCHEDULED, TIMED,
 * POSTPONED, SUSPENDED, CANCELLED, …) is 'pending' and left alone.
 */
export function classifyFeedStatus(status: string): FeedState {
  switch (status) {
    case 'IN_PLAY':
    case 'PAUSED':
      return 'live';
    case 'FINISHED':
    case 'AWARDED':
      return 'final';
    default:
      return 'pending';
  }
}

/** The minimal shape we read from a football-data match. */
interface FeedMatch {
  id: number;
  status: string;
  score?: { fullTime?: { home: number | null; away: number | null } };
}

/** Read the running/final score off a feed match, or null when absent. */
export function scoreOf(m: FeedMatch): { home: number; away: number } | null {
  const ft = m.score?.fullTime;
  if (!ft || typeof ft.home !== 'number' || typeof ft.away !== 'number') return null;
  return { home: ft.home, away: ft.away };
}

// --- config (env, with sensible defaults) ----------------------------------
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const COMPETITION = process.env.FD_COMPETITION ?? 'WC';
const EXT_REF_PREFIX = process.env.FD_EXT_REF_PREFIX ?? 'FD-';
const POLL_SECS = Math.max(20, Number(process.env.LIVE_POLL_SECS ?? 60)); // SI seconds

/** One poll: fetch the competition, update live scores, settle finals. */
async function pollOnce(): Promise<void> {
  const res = await fetch(
    `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`,
    { headers: { 'X-Auth-Token': TOKEN as string } },
  );
  if (!res.ok) {
    console.error(`[live] football-data responded ${res.status}; skipping this pass`);
    return;
  }
  const body = (await res.json()) as { matches?: FeedMatch[] };
  const matches = body.matches ?? [];

  let liveUpdated = 0;
  let settled = 0;
  for (const m of matches) {
    const state = classifyFeedStatus(m.status);
    if (state === 'pending') continue;
    const score = scoreOf(m);
    if (!score) continue;

    // Find the fixture we hold for this feed match (the adapter's ext_ref).
    const row = (
      await pool.query<{ id: string; status: string }>(
        'SELECT id, status FROM matches WHERE ext_ref = $1',
        [`${EXT_REF_PREFIX}${m.id}`],
      )
    ).rows[0];
    if (!row) continue; // not a fixture we track
    if (row.status === 'final') continue; // already settled — never re-touch

    if (state === 'final') {
      // Settle once: score, points, totals, wagers (idempotent pipeline).
      await settleMatch(row.id, score.home, score.away);
      settled += 1;
    } else {
      // Live: keep the running score on screen; do NOT settle.
      await pool.query(
        "UPDATE matches SET home_score = $1, away_score = $2, status = 'live' WHERE id = $3",
        [score.home, score.away, row.id],
      );
      liveUpdated += 1;
    }
  }
  if (liveUpdated > 0 || settled > 0) {
    console.log(`[live] ${liveUpdated} live update(s), ${settled} settled`);
  }
}

/**
 * Start the background poller. No-op (with a notice) when FOOTBALL_DATA_TOKEN
 * is unset, so the API runs without live scores in local development.
 */
export function startLiveScores(): void {
  if (!TOKEN) {
    console.log('[live] FOOTBALL_DATA_TOKEN unset — live-score/settlement poller disabled');
    return;
  }
  console.log(`[live] poller on: every ${POLL_SECS} s from football-data /${COMPETITION}`);
  const tick = (): void => {
    pollOnce().catch((err) =>
      console.error('[live] poll failed:', err instanceof Error ? err.message : err),
    );
  };
  tick(); // immediate first pass
  // unref() so the timer alone never keeps the process alive (the HTTP server
  // does); the poll still fires for the life of the server.
  setInterval(tick, POLL_SECS * 1000).unref();
}
