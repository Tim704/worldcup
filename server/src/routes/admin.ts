/**
 * routes/admin.ts — admin controls (Contract §4, §6).
 *
 *   POST /api/admin/matches/:id/score   { home_score, away_score }
 *        → { match, predictions_scored, wagers_resolved }
 *   POST /api/admin/matches/:id/feature { is_featured }              → Match
 *   POST /api/admin/matches/:id/status  { status: 'scheduled'|'live' } → Match
 *        ('final' is reachable ONLY through /score)
 *
 * Every route here sits behind requireAuth + requireAdmin (the latter
 * re-checks users.is_admin from the DB on every call — Contract §6).
 *
 * The /score settlement pipeline runs as ONE transaction (Contract §4) and
 * is IDEMPOTENT: re-submitting a corrected score re-runs the same pipeline
 * and may flip prediction points and wager outcomes.
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { scorePrediction } from '../lib/scoring.js';
import { resolveWager } from '../lib/wagers.js';
import { vBody, vEnum, vBool, vInt, vUuid } from '../lib/validate.js';
import { mapMatchRow, type SqlRow, type WagerState } from '../types.js';

const router = express.Router();

// Admin wall: auth first, then a fresh is_admin check from the DB.
router.use(requireAuth, requireAdmin);

/**
 * POST /api/admin/matches/:id/score — the settlement pipeline (Contract §4).
 *
 * ONE transaction, five steps:
 *  1. persist the final score and flip status to 'final';
 *  2. score every prediction with the PURE TS function (the source of truth
 *     — SQL only persists), written back in ONE batch UPDATE via unnest;
 *  3. recompute EVERY user's total_points in ONE statement (full recompute,
 *     no increments — that is what makes re-submission idempotent; no N+1);
 *  4. resolve this match's accepted wagers with the pure resolver, batch-
 *     updated the same unnest way — previously-RESOLVED wagers are re-graded
 *     too, so a corrected score can flip an outcome;
 *  5. commit.
 */
router.post(
  '/matches/:id/score',
  asyncHandler(async (req, res) => {
    const matchId = vUuid(req.params.id, 'match id');
    const body = vBody(req.body);
    // 0–99 keeps us comfortably inside SMALLINT and football reality; the DB
    // CHECK only enforces >= 0.
    const homeScore = vInt(body.home_score, 'home_score', 0, 99);
    const awayScore = vInt(body.away_score, 'away_score', 0, 99);

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

      res.json({
        match: mapMatchRow(matchRow),
        predictions_scored: predIds.length,
        wagers_resolved: wagerIds.length,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

/** POST /api/admin/matches/:id/feature — toggle the "Main Event" flag. */
router.post(
  '/matches/:id/feature',
  asyncHandler(async (req, res) => {
    const matchId = vUuid(req.params.id, 'match id');
    const body = vBody(req.body);
    const isFeatured = vBool(body.is_featured, 'is_featured');

    const result = await pool.query(
      'UPDATE matches SET is_featured = $1 WHERE id = $2 RETURNING *',
      [isFeatured, matchId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'match not found');
    res.json(mapMatchRow(row));
  }),
);

/**
 * POST /api/admin/matches/:id/status — flip between 'scheduled' and 'live'.
 * 'final' is deliberately NOT accepted here: a match only becomes final via
 * the /score settlement pipeline above (vEnum rejects it with VALIDATION).
 */
router.post(
  '/matches/:id/status',
  asyncHandler(async (req, res) => {
    const matchId = vUuid(req.params.id, 'match id');
    const body = vBody(req.body);
    const status = vEnum(body.status, 'status', ['scheduled', 'live'] as const);

    const result = await pool.query(
      'UPDATE matches SET status = $1::match_status WHERE id = $2 RETURNING *',
      [status, matchId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'match not found');
    res.json(mapMatchRow(row));
  }),
);

export default router;
