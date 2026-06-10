/**
 * routes/leaderboard.ts — GET /api/leaderboard (Contract §6).
 *
 * ONE query, no N+1 (.claude/rules/database.md): ranked by total_points
 * DESC via DENSE_RANK(), display ties broken by exact hits DESC then
 * lower(username) ASC. The int8 aggregates (COUNT / DENSE_RANK) come back
 * from `pg` as strings and are cast to Number by mapLeaderboardRow.
 */
import express from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../error.js';
import { mapLeaderboardRow } from '../types.js';

const router = express.Router();

/** Canonical leaderboard query — verbatim from Contract §6. */
const LEADERBOARD_SQL = `
  SELECT u.id AS user_id, u.username, u.display_name, u.total_points,
         COUNT(p.id) FILTER (WHERE p.points_awarded = 5)        AS exact_hits,
         COUNT(p.id) FILTER (WHERE p.points_awarded = 2)        AS outcome_hits,
         COUNT(p.id) FILTER (WHERE p.points_awarded IS NOT NULL) AS predictions_settled,
         DENSE_RANK() OVER (ORDER BY u.total_points DESC)        AS rank
  FROM users u LEFT JOIN predictions p ON p.user_id = u.id
  GROUP BY u.id
  ORDER BY u.total_points DESC, exact_hits DESC, lower(u.username) ASC
`;

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const result = await pool.query(LEADERBOARD_SQL);
    res.json(result.rows.map(mapLeaderboardRow));
  }),
);

export default router;
