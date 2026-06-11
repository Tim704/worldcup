/**
 * routes/bracket.ts — the Tournament Predictor prophecy (Contract §11).
 *
 *   GET  /api/bracket          (auth) → { bracket: BracketPrediction | null }
 *   GET  /api/bracket/:userId  (auth) → { user, bracket } — browse another's
 *   POST /api/bracket          (auth) { group_picks, third_picks, bracket_picks }
 *        → BracketPrediction — upsert on user_id (one prophecy per user)
 *
 * Unlike per-match calls there is no lock guard: the bracket is a season-long
 * living document — friends keep re-writing the future until it arrives. The
 * whole document is replaced atomically in ONE statement (it is internally
 * interdependent: a group re-order cascades through the knockout tree, so
 * partial writes could never be consistent).
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { requireAuth } from '../middleware/auth.js';
import { vBody, vUuid } from '../lib/validate.js';
import { vBracketPicks, vGroupPicks, vThirdPicks } from '../lib/bracketPicks.js';
import { mapBracketPredictionRow } from '../types.js';

const router = express.Router();

/** GET /api/bracket — my prophecy, or null when none is on file yet. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM bracket_predictions WHERE user_id = $1',
      [req.auth!.userId],
    );
    const row = result.rows[0];
    res.json({ bracket: row ? mapBracketPredictionRow(row) : null });
  }),
);

/** POST /api/bracket — create or rewrite my prophecy (single-statement upsert). */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = vBody(req.body);
    const groupPicks = vGroupPicks(body.group_picks);
    const thirdPicks = vThirdPicks(body.third_picks);
    const bracketPicks = vBracketPicks(body.bracket_picks);

    // JSON.stringify + ::jsonb casts on ALL three params: node-postgres
    // serialises a plain object to JSON, but a bare JS ARRAY is encoded as a
    // Postgres array literal (a classic jsonb foot-gun for third_picks) —
    // stringifying everything keeps the encoding uniform and unambiguous.
    const result = await pool.query(
      `INSERT INTO bracket_predictions (user_id, group_picks, third_picks, bracket_picks)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET group_picks   = EXCLUDED.group_picks,
                     third_picks   = EXCLUDED.third_picks,
                     bracket_picks = EXCLUDED.bracket_picks,
                     updated_at    = now()
       RETURNING *`,
      [
        req.auth!.userId,
        JSON.stringify(groupPicks),
        JSON.stringify(thirdPicks),
        JSON.stringify(bracketPicks),
      ],
    );
    res.json(mapBracketPredictionRow(result.rows[0]));
  }),
);

/**
 * GET /api/bracket/:userId — read another player's prophecy (auth required).
 *
 * Brackets carry no lock (a season-long living document), so unlike match
 * calls there is nothing to keep secret: any signed-in player may browse any
 * other's tree. ONE query, no N+1 — the LEFT JOIN returns the player even when
 * they have no prophecy on file yet (then `bracket` is null), and a missing
 * player is a clean 404. Passing your OWN id simply returns what GET
 * /api/bracket would.
 */
router.get(
  '/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = vUuid(req.params.userId, 'user id');
    const result = await pool.query(
      `SELECT u.id AS u_id, u.username, u.display_name,
              b.id, b.user_id, b.group_picks, b.third_picks, b.bracket_picks,
              b.created_at, b.updated_at
         FROM users u
         LEFT JOIN bracket_predictions b ON b.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'no such player');
    res.json({
      user: { id: row.u_id, username: row.username, display_name: row.display_name },
      bracket: row.id ? mapBracketPredictionRow(row) : null,
    });
  }),
);

export default router;
