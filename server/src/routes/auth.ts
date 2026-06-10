/**
 * routes/auth.ts — passwordless auth (Contract §6).
 *
 *   POST /api/auth/login   { username, display_name? } → { token, user }
 *   GET  /api/auth/me      (auth)                      → User
 *
 * Login = upsert by username:
 *  - trim, validate ^[A-Za-z0-9_ ]{2,20}$;
 *  - lookup by lower(username); create when absent (display_name defaults to
 *    the username AS TYPED — original casing preserved);
 *  - if the lowercased username appears in env ADMIN_USERNAMES
 *    (comma-separated), set is_admin = true on EVERY login (promotion takes
 *    effect at next login; never demotes);
 *  - a display_name supplied on a later login updates the stored one (upsert
 *    semantics).
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { vBody, vString, vUsername } from '../lib/validate.js';
import { mapUserRow, type SqlRow } from '../types.js';

const router = express.Router();

/** Parse env ADMIN_USERNAMES (comma-separated) into lowercased entries. */
function adminUsernames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = vBody(req.body);
    const username = vUsername(body.username); // trimmed, regex-validated
    // display_name is optional; when present it must be a sensible short
    // string (1–60 chars after trimming).
    const displayName =
      body.display_name === undefined || body.display_name === null
        ? null
        : vString(body.display_name, 'display_name', 1, 60);

    const lowered = username.toLowerCase();
    const shouldBeAdmin = adminUsernames().includes(lowered);

    // 1. Lookup by lower(username) — the unique index makes this exact.
    let row: SqlRow | undefined = (
      await pool.query('SELECT * FROM users WHERE lower(username) = $1', [lowered])
    ).rows[0];

    // 2. Create when absent. A concurrent first-login race trips the unique
    //    index (SQLSTATE 23505) — recover by re-selecting the winner's row.
    if (!row) {
      try {
        row = (
          await pool.query(
            `INSERT INTO users (username, display_name, is_admin)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [username, displayName ?? username, shouldBeAdmin],
          )
        ).rows[0];
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode === '23505') {
          row = (
            await pool.query('SELECT * FROM users WHERE lower(username) = $1', [lowered])
          ).rows[0];
        } else {
          throw err;
        }
      }
    }
    if (!row) {
      throw new AppError('INTERNAL', 'user upsert failed unexpectedly');
    }

    // 3. Per-login maintenance: promote to admin when listed in
    //    ADMIN_USERNAMES; adopt a freshly supplied display_name. One UPDATE,
    //    only when something actually changes.
    const needsAdminFlag = shouldBeAdmin && !row.is_admin;
    const needsDisplayName = displayName !== null && displayName !== row.display_name;
    if (needsAdminFlag || needsDisplayName) {
      row = (
        await pool.query(
          `UPDATE users
              SET is_admin     = (is_admin OR $2),
                  display_name = COALESCE($3, display_name)
            WHERE id = $1
            RETURNING *`,
          [row.id, shouldBeAdmin, displayName],
        )
      ).rows[0] as SqlRow;
    }

    const user = mapUserRow(row);
    res.json({ token: signToken(user.id, user.username), user });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // req.auth is guaranteed by requireAuth; re-read the user from the DB so
    // the SPA always sees fresh is_admin / total_points / display_name.
    const row = (await pool.query('SELECT * FROM users WHERE id = $1', [req.auth!.userId]))
      .rows[0];
    if (!row) {
      // Token references a deleted user — force the client to drop it.
      throw new AppError('UNAUTHENTICATED', 'token user no longer exists');
    }
    res.json(mapUserRow(row));
  }),
);

export default router;
