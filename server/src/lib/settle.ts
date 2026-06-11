/**
 * settle.ts — the match settlement pipeline (Contract §4).
 *
 * ONE idempotent transaction, five steps. Extracted from the admin /score
 * route so the SAME pipeline backs both the manual admin settlement and the
 * automatic live-score settler (lib/liveScores.ts) — there is exactly one
 * place that turns a final score into points + resolved wagers.
 */
import { pool } from '../db.js';
import { AppError } from '../error.js';
import { scorePrediction } from './scoring.js';
import { resolveWager } from './wagers.js';
import { mapMatchRow, type Match, type SqlRow, type WagerState } from '../types.js';

/** What a settlement run reports back. */
export interface SettleResult {
  match: Match;
  predictions_scored: number;
  wagers_resolved: number;
}

/**
 * Persist a final score and settle the match (Contract §4):
 *  1. write the final score, flip status to 'final';
 *  2. score every prediction with the PURE 5/2/0 function, one batch UPDATE;
 *  3. recompute EVERY user's total_points in one statement (full recompute →
 *     re-submission is idempotent; no N+1);
 *  4. resolve this match's non-PENDING wagers with the pure resolver, batched;
 *  5. commit — the whole thing is atomic.
 *
 * Idempotent: re-running with a corrected score re-grades predictions and
 * wagers and recomputes totals to the same result. Throws AppError NOT_FOUND
 * when the match id does not exist.
 */
export async function settleMatch(
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<SettleResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1 — final score in, status 'final'.
    const matchResult = await client.query(
      `UPDATE matches
          SET home_score = $1, away_score = $2, status = 'final'
        WHERE id = $3
        RETURNING *`,
      [homeScore, awayScore, matchId],
    );
    const matchRow = matchResult.rows[0];
    if (!matchRow) throw new AppError('NOT_FOUND', 'match not found');

    // Step 2 — score every prediction in TypeScript (pure 5/2/0 function),
    // then persist all verdicts in ONE batch UPDATE via unnest.
    const preds = await client.query(
      'SELECT id, pred_home, pred_away FROM predictions WHERE match_id = $1',
      [matchId],
    );
    const predIds: string[] = [];
    const predPts: number[] = [];
    for (const p of preds.rows as SqlRow[]) {
      predIds.push(p.id);
      predPts.push(scorePrediction(Number(p.pred_home), Number(p.pred_away), homeScore, awayScore));
    }
    if (predIds.length > 0) {
      await client.query(
        `UPDATE predictions p SET points_awarded = v.pts, updated_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS pts) v
         WHERE p.id = v.id`,
        [predIds, predPts],
      );
    }

    // Step 3 — full season-total recompute for EVERY user, one statement.
    await client.query(
      `UPDATE users u SET total_points = COALESCE((SELECT SUM(p.points_awarded) FROM predictions p WHERE p.user_id = u.id AND p.points_awarded IS NOT NULL), 0)`,
    );

    // Step 4 — resolve this match's accepted wagers. We pick up everything
    // that is NOT PENDING (i.e. ACCEPTED plus already-RESOLVED rows from a
    // previous submission) so a corrected score can flip earlier verdicts.
    // PENDING wagers stay PENDING forever ("expired, unclaimed").
    const wagers = await client.query(
      `SELECT id, creator_id, acceptor_id, pick, margin
         FROM wagers
        WHERE match_id = $1 AND state <> 'PENDING'`,
      [matchId],
    );
    const wagerIds: string[] = [];
    const wagerStates: WagerState[] = [];
    const winnerIds: string[] = [];
    const loserIds: string[] = [];
    for (const w of wagers.rows as SqlRow[]) {
      const verdict = resolveWager(
        w.pick,
        w.margin === null ? null : Number(w.margin),
        homeScore,
        awayScore,
      );
      wagerIds.push(w.id);
      wagerStates.push(verdict.state);
      // Creator wins → winner = creator, loser = acceptor; else swapped.
      // The loser owes the forfeit.
      winnerIds.push(verdict.creator_wins ? w.creator_id : w.acceptor_id);
      loserIds.push(verdict.creator_wins ? w.acceptor_id : w.creator_id);
    }
    if (wagerIds.length > 0) {
      await client.query(
        `UPDATE wagers w
            SET state = v.state, winner_id = v.winner_id, loser_id = v.loser_id,
                resolved_at = now()
         FROM (SELECT unnest($1::uuid[])               AS id,
                      unnest($2::text[])::wager_state  AS state,
                      unnest($3::uuid[])               AS winner_id,
                      unnest($4::uuid[])               AS loser_id) v
         WHERE w.id = v.id`,
        [wagerIds, wagerStates, winnerIds, loserIds],
      );
    }

    // Step 5 — commit; the whole settlement is atomic.
    await client.query('COMMIT');

    return {
      match: mapMatchRow(matchRow),
      predictions_scored: predIds.length,
      wagers_resolved: wagerIds.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
