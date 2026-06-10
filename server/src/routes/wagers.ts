/**
 * routes/wagers.ts — the public wagers marketplace (Contract §5, §6).
 *
 *   GET    /api/wagers?state=&user_id=        → WagerView[] newest first
 *   POST   /api/wagers              (auth)    { match_id, pick, margin?, claim } → WagerView
 *   POST   /api/wagers/:id/accept   (auth)    { forfeit } → WagerView
 *   DELETE /api/wagers/:id          (auth)    creator only, PENDING only → { deleted: true }
 *
 * Lifecycle guards (Contract §5, creator's perspective):
 *   create : auth; match exists; now < lock_at; valid fields        → PENDING
 *   accept : auth; acceptor ≠ creator; state PENDING; now < lock_at;
 *            forfeit 3–140 chars                                    → ACCEPTED
 *   delete : creator only; state still PENDING                      → row gone
 *   settle : admin /score pipeline only (routes/admin.ts)           → RESOLVED_*
 *
 * PENDING wagers whose match locks without an acceptor stay PENDING in the
 * DB — the accept guard makes them un-acceptable and the UI shows them as
 * "expired, unclaimed".
 */
import express from 'express';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../error.js';
import { requireAuth } from '../middleware/auth.js';
import { invalid, vBody, vEnum, vInt, vString, vUuid } from '../lib/validate.js';
import {
  mapWagerViewRow,
  type WagerPick,
  type WagerState,
} from '../types.js';

const router = express.Router();

const WAGER_STATES: readonly WagerState[] = ['PENDING', 'ACCEPTED', 'RESOLVED_WON', 'RESOLVED_LOST'];
const WAGER_PICKS: readonly WagerPick[] = ['home', 'draw', 'away'];

/**
 * The marketplace view: wager + all four usernames + match info, one query.
 * creator is a hard JOIN (NOT NULL FK); acceptor/winner/loser are LEFT JOINs.
 */
const WAGER_VIEW_SQL = `
  SELECT w.id, w.match_id, w.creator_id, w.acceptor_id, w.pick, w.margin,
         w.claim, w.forfeit, w.state, w.winner_id, w.loser_id,
         w.created_at, w.accepted_at, w.resolved_at,
         cu.username AS creator_username,
         au.username AS acceptor_username,
         wu.username AS winner_username,
         lu.username AS loser_username,
         m.home_team, m.away_team, m.kickoff_at, m.lock_at,
         m.status AS match_status, m.home_score, m.away_score
    FROM wagers w
    JOIN matches m  ON m.id  = w.match_id
    JOIN users   cu ON cu.id = w.creator_id
    LEFT JOIN users au ON au.id = w.acceptor_id
    LEFT JOIN users wu ON wu.id = w.winner_id
    LEFT JOIN users lu ON lu.id = w.loser_id
`;

/** Fetch one wager as a WagerView (post-mutation reads go through this). */
async function fetchWagerView(wagerId: string) {
  const result = await pool.query(`${WAGER_VIEW_SQL} WHERE w.id = $1`, [wagerId]);
  const row = result.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'wager not found');
  return mapWagerViewRow(row);
}

/**
 * GET /api/wagers — the marketplace feed, newest first.
 * Optional filters: ?state= one of the four states; ?user_id= rows where the
 * user is creator OR acceptor (the SPA's "mine" tab). Empty values are
 * treated as absent (the contract spells the URL as `?state=&user_id=`).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const rawState = req.query.state;
    if (rawState !== undefined && rawState !== '') {
      const state = vEnum(rawState, 'state', WAGER_STATES);
      params.push(state);
      conditions.push(`w.state = $${params.length}::wager_state`);
    }

    const rawUserId = req.query.user_id;
    if (rawUserId !== undefined && rawUserId !== '') {
      const userId = vUuid(rawUserId, 'user_id');
      params.push(userId);
      conditions.push(`(w.creator_id = $${params.length} OR w.acceptor_id = $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `${WAGER_VIEW_SQL} ${where} ORDER BY w.created_at DESC`,
      params,
    );
    res.json(result.rows.map(mapWagerViewRow));
  }),
);

/** POST /api/wagers — put a boast on the table (state PENDING). */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = vBody(req.body);
    const matchId = vUuid(body.match_id, 'match_id');
    const pick = vEnum(body.pick, 'pick', WAGER_PICKS);
    const claim = vString(body.claim, 'claim', 3, 140);

    // margin: optional "wins by ≥ N goals" — integer 1–10, non-draw picks
    // only (mirrors the wagers_margin_needs_side CHECK).
    let margin: number | null = null;
    if (body.margin !== undefined && body.margin !== null) {
      margin = vInt(body.margin, 'margin', 1, 10);
      if (pick === 'draw') {
        invalid('margin is only allowed on home/away picks');
      }
    }

    // Guard: match exists and is still open (now < lock_at, DB clock).
    const match = await pool.query(
      'SELECT id, (now() >= lock_at) AS locked FROM matches WHERE id = $1',
      [matchId],
    );
    const m = match.rows[0];
    if (!m) throw new AppError('NOT_FOUND', 'match not found');
    if (m.locked) {
      throw new AppError('MATCH_LOCKED', 'locked. the ball is rolling.');
    }

    const inserted = await pool.query(
      `INSERT INTO wagers (match_id, creator_id, pick, margin, claim)
       VALUES ($1, $2, $3::wager_pick, $4, $5)
       RETURNING id`,
      [matchId, req.auth!.userId, pick, margin, claim],
    );
    res.json(await fetchWagerView(inserted.rows[0].id));
  }),
);

/** POST /api/wagers/:id/accept — take the bet, stake a forfeit. */
router.post(
  '/:id/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const wagerId = vUuid(req.params.id, 'wager id');
    const body = vBody(req.body);
    const forfeit = vString(body.forfeit, 'forfeit', 3, 140);

    // Load the wager with its lock status in one query (DB clock).
    const found = await pool.query(
      `SELECT w.id, w.creator_id, w.state, (now() >= m.lock_at) AS locked
         FROM wagers w
         JOIN matches m ON m.id = w.match_id
        WHERE w.id = $1`,
      [wagerId],
    );
    const w = found.rows[0];
    if (!w) throw new AppError('NOT_FOUND', 'wager not found');
    if (w.creator_id === req.auth!.userId) {
      throw new AppError('WAGER_CONFLICT', 'you cannot accept your own wager');
    }
    if (w.state !== 'PENDING') {
      throw new AppError('WAGER_CONFLICT', `wager is ${w.state}, not PENDING`);
    }
    if (w.locked) {
      // An unclaimed wager on a locked match has expired — no longer acceptable.
      throw new AppError('MATCH_LOCKED', 'locked. the ball is rolling.');
    }

    // Conditional UPDATE re-checks the state so two concurrent acceptors
    // cannot both win the row — exactly one sees rowCount = 1.
    const updated = await pool.query(
      `UPDATE wagers
          SET acceptor_id = $2,
              forfeit     = $3,
              state       = 'ACCEPTED',
              accepted_at = now()
        WHERE id = $1
          AND state = 'PENDING'
        RETURNING id`,
      [wagerId, req.auth!.userId, forfeit],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new AppError('WAGER_CONFLICT', 'wager was accepted by someone else first');
    }
    res.json(await fetchWagerView(wagerId));
  }),
);

/** DELETE /api/wagers/:id — creator withdraws an unclaimed (PENDING) boast. */
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const wagerId = vUuid(req.params.id, 'wager id');

    const found = await pool.query('SELECT id, creator_id, state FROM wagers WHERE id = $1', [
      wagerId,
    ]);
    const w = found.rows[0];
    if (!w) throw new AppError('NOT_FOUND', 'wager not found');
    if (w.creator_id !== req.auth!.userId) {
      throw new AppError('FORBIDDEN', 'only the creator can withdraw a wager');
    }
    if (w.state !== 'PENDING') {
      throw new AppError('WAGER_CONFLICT', `wager is ${w.state}, not PENDING`);
    }

    // Conditional DELETE guards against a concurrent accept landing between
    // the read above and this statement.
    const deleted = await pool.query(
      `DELETE FROM wagers WHERE id = $1 AND creator_id = $2 AND state = 'PENDING'`,
      [wagerId, req.auth!.userId],
    );
    if ((deleted.rowCount ?? 0) === 0) {
      throw new AppError('WAGER_CONFLICT', 'wager was accepted before it could be withdrawn');
    }
    res.json({ deleted: true });
  }),
);

export default router;
