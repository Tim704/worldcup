/**
 * routes/matches.ts — match feed (Contract §6).
 *
 *   GET /api/matches                  (opt auth) → MatchWithMine[]  kickoff_at ASC
 *   GET /api/matches/next             (opt auth) → { match: MatchWithMine | null }
 *   GET /api/matches/:id              (opt auth) → MatchWithMine
 *   GET /api/matches/:id/predictions             → PredictionWithUser[]
 *                                       ONLY once now ≥ lock_at — picks are
 *                                       secret until lock (else 409 MATCH_LOCKED)
 *
 * `my_prediction` is joined in the same query when a valid token is present
 * (LEFT JOIN on user_id — binds NULL for anonymous callers, so the join
 * simply never matches and one query serves both cases, no N+1).
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { optionalAuth } from '../middleware/auth.js';
import { vUuid } from '../lib/validate.js';
import {
  iso,
  mapMatchRow,
  numOrNull,
  type MatchWithMine,
  type Prediction,
  type SqlRow,
} from '../types.js';

const router = express.Router();

/**
 * One query, two shapes: the match columns plus the caller's own prediction
 * aliased p_* (NULL when anonymous or not yet predicted). $1 = user id | null.
 */
const MATCH_WITH_MINE_SQL = `
  SELECT m.*,
         p.id             AS p_id,
         p.user_id        AS p_user_id,
         p.match_id       AS p_match_id,
         p.pred_home      AS p_pred_home,
         p.pred_away      AS p_pred_away,
         p.points_awarded AS p_points_awarded,
         p.created_at     AS p_created_at,
         p.updated_at     AS p_updated_at
    FROM matches m
    LEFT JOIN predictions p
      ON p.match_id = m.id
     AND p.user_id  = $1
`;

/** Build the joined my_prediction (or null) from the aliased p_* columns. */
function myPredictionFrom(r: SqlRow): Prediction | null {
  if (!r.p_id) return null;
  return {
    id: r.p_id,
    user_id: r.p_user_id,
    match_id: r.p_match_id,
    pred_home: Number(r.p_pred_home),
    pred_away: Number(r.p_pred_away),
    points_awarded: numOrNull(r.p_points_awarded),
    created_at: iso(r.p_created_at),
    updated_at: iso(r.p_updated_at),
  };
}

/** Full row → MatchWithMine. */
function mapMatchWithMine(r: SqlRow): MatchWithMine {
  return { ...mapMatchRow(r), my_prediction: myPredictionFrom(r) };
}

/** GET /api/matches — the whole feed, kickoff_at ASC. */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`${MATCH_WITH_MINE_SQL} ORDER BY m.kickoff_at ASC`, [
      req.auth?.userId ?? null,
    ]);
    res.json(result.rows.map(mapMatchWithMine));
  }),
);

/**
 * GET /api/matches/next — the chronologically first match that is still
 * OPEN (lock_at > now, DB clock). Null when nothing is upcoming.
 * NOTE: registered before '/:id' so the literal path wins.
 */
router.get(
  '/next',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `${MATCH_WITH_MINE_SQL} WHERE m.lock_at > now() ORDER BY m.kickoff_at ASC LIMIT 1`,
      [req.auth?.userId ?? null],
    );
    const row = result.rows[0];
    res.json({ match: row ? mapMatchWithMine(row) : null });
  }),
);

/** GET /api/matches/:id — one match, my prediction joined when authed. */
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const matchId = vUuid(req.params.id, 'match id');
    const result = await pool.query(`${MATCH_WITH_MINE_SQL} WHERE m.id = $2`, [
      req.auth?.userId ?? null,
      matchId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'match not found');
    res.json(mapMatchWithMine(row));
  }),
);

/**
 * GET /api/matches/:id/predictions — everyone's calls for one match.
 * Picks are SECRET until lock: before lock_at this is 409 MATCH_LOCKED.
 * The lock comparison uses the DATABASE clock (now() ≥ lock_at) so the
 * privacy boundary is exactly the same one the prediction-upsert guard uses.
 */
router.get(
  '/:id/predictions',
  asyncHandler(async (req, res) => {
    const matchId = vUuid(req.params.id, 'match id');

    const match = await pool.query(
      'SELECT id, (now() >= lock_at) AS locked FROM matches WHERE id = $1',
      [matchId],
    );
    const m = match.rows[0];
    if (!m) throw new AppError('NOT_FOUND', 'match not found');
    if (!m.locked) {
      throw new AppError('MATCH_LOCKED', 'picks are secret until lock');
    }

    const result = await pool.query(
      `SELECT p.*, u.username, u.display_name
         FROM predictions p
         JOIN users u ON u.id = p.user_id
        WHERE p.match_id = $1
        ORDER BY lower(u.username) ASC`,
      [matchId],
    );
    res.json(
      result.rows.map((r: SqlRow) => ({
        id: r.id,
        user_id: r.user_id,
        match_id: r.match_id,
        pred_home: Number(r.pred_home),
        pred_away: Number(r.pred_away),
        points_awarded: numOrNull(r.points_awarded),
        created_at: iso(r.created_at),
        updated_at: iso(r.updated_at),
        username: r.username,
        display_name: r.display_name,
      })),
    );
  }),
);

export default router;
