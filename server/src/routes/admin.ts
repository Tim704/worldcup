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
import { settleMatch } from '../lib/settle.js';
import { vBody, vEnum, vBool, vInt, vUuid } from '../lib/validate.js';
import { mapMatchRow } from '../types.js';

const router = express.Router();

// Admin wall: auth first, then a fresh is_admin check from the DB.
router.use(requireAuth, requireAdmin);

/**
 * POST /api/admin/matches/:id/score — manual settlement (Contract §4).
 *
 * Thin wrapper over the shared {@link settleMatch} pipeline (lib/settle.ts) —
 * the same idempotent transaction the automatic live-score settler uses. Admin
 * use is for entering / correcting a result by hand; re-submitting a corrected
 * score re-grades predictions and wagers and recomputes totals.
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

    res.json(await settleMatch(matchId, homeScore, awayScore));
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
