/**
 * routes/predictions.ts — score predictions (Contract §6).
 *
 *   POST /api/predictions       (auth) { match_id, pred_home, pred_away } → Prediction
 *        upsert on (user_id, match_id); 409 MATCH_LOCKED when now ≥ lock_at;
 *        goal counts 0–20 (mirrors the DB CHECK)
 *   GET  /api/predictions/mine  (auth) → Prediction[]
 *
 * The lock guard compares against the DATABASE clock (now() ≥ lock_at), the
 * same boundary the per-match listing uses for privacy — one clock, no drift.
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { requireAuth } from '../middleware/auth.js';
import { vBody, vInt, vUuid } from '../lib/validate.js';
import { mapPredictionRow } from '../types.js';

const router = express.Router();

/** POST /api/predictions — create or update my call for a match. */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = vBody(req.body);
    const matchId = vUuid(body.match_id, 'match_id');
    const predHome = vInt(body.pred_home, 'pred_home', 0, 20);
    const predAway = vInt(body.pred_away, 'pred_away', 0, 20);

    // Guard: match must exist and still be open (now < lock_at, DB clock).
    const match = await pool.query(
      'SELECT id, (now() >= lock_at) AS locked FROM matches WHERE id = $1',
      [matchId],
    );
    const m = match.rows[0];
    if (!m) throw new AppError('NOT_FOUND', 'match not found');
    if (m.locked) {
      throw new AppError('MATCH_LOCKED', 'locked. the ball is rolling.');
    }

    // Upsert on the (user_id, match_id) unique constraint — editing a call
    // before lock simply overwrites it and bumps updated_at.
    const result = await pool.query(
      `INSERT INTO predictions (user_id, match_id, pred_home, pred_away)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET pred_home  = EXCLUDED.pred_home,
                     pred_away  = EXCLUDED.pred_away,
                     updated_at = now()
       RETURNING *`,
      [req.auth!.userId, matchId, predHome, predAway],
    );
    res.json(mapPredictionRow(result.rows[0]));
  }),
);

/** GET /api/predictions/mine — all my calls, in match-kickoff order. */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT p.*
         FROM predictions p
         JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = $1
        ORDER BY m.kickoff_at ASC`,
      [req.auth!.userId],
    );
    res.json(result.rows.map(mapPredictionRow));
  }),
);

export default router;
