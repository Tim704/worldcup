/**
 * middleware/auth.ts — passwordless JWT auth (Contract §6).
 *
 * Token: JWT HS256 signed with env APP_SECRET, payload { sub: user.id,
 * username }, expiry 90 days (7 776 000 s). Clients send
 * `Authorization: Bearer <token>`.
 *
 * Middleware:
 *  - requireAuth  — 401 UNAUTHENTICATED when the token is missing/invalid;
 *  - optionalAuth — attaches auth when a valid token is present, otherwise
 *                   continues anonymously (a stale token must not break
 *                   public reads — the SPA re-validates via GET /api/auth/me);
 *  - requireAdmin — 403 FORBIDDEN; re-checks users.is_admin FROM THE DB on
 *                   every call (never trusts a stale token claim).
 */
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { AppError } from '../error.js';

/** What a verified token tells us about the caller. */
export interface AuthInfo {
  /** users.id (UUID) — the JWT `sub` claim. */
  userId: string;
  /** username at signing time (display convenience; DB is authoritative). */
  username: string;
}

// Attach `auth` to Express's Request so handlers get typed access.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

/** Token lifetime: 90 days = 7 776 000 s (SI seconds). */
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Development fallback secret (Contract §8) — index.ts warns loudly about it. */
const DEV_FALLBACK_SECRET = 'dev-secret-change-me';

/** Read the signing secret at call time (env may load after module import). */
function appSecret(): string {
  return process.env.APP_SECRET || DEV_FALLBACK_SECRET;
}

/** Sign a fresh 90-day HS256 token for a user. */
export function signToken(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username }, appSecret(), {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL_SECONDS, // 7 776 000 s = 90 days
  });
}

/**
 * Verify a raw token and extract AuthInfo, or return null when anything is
 * off (bad signature, expired, malformed payload). Never throws.
 */
function verifyToken(token: string): AuthInfo | null {
  try {
    const payload = jwt.verify(token, appSecret(), { algorithms: ['HS256'] });
    if (typeof payload === 'string' || payload === null) return null;
    const sub = payload.sub;
    const username = (payload as Record<string, unknown>)['username'];
    if (typeof sub !== 'string' || sub.length === 0) return null;
    if (typeof username !== 'string' || username.length === 0) return null;
    return { userId: sub, username };
  } catch {
    return null;
  }
}

/** Pull `Bearer <token>` out of the Authorization header, if present. */
function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/** 401 UNAUTHENTICATED unless a valid Bearer token is presented. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  const auth = token ? verifyToken(token) : null;
  if (!auth) {
    next(new AppError('UNAUTHENTICATED', 'a valid bearer token is required'));
    return;
  }
  req.auth = auth;
  next();
}

/**
 * Attach auth when a valid token is presented; otherwise proceed anonymously.
 * An invalid/expired token is treated as anonymous on these public routes —
 * the SPA discovers staleness via GET /api/auth/me (which 401s) and drops it.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (token) {
    const auth = verifyToken(token);
    if (auth) req.auth = auth;
  }
  next();
}

/**
 * 403 FORBIDDEN unless the authenticated user is an admin RIGHT NOW.
 * Always re-reads users.is_admin from the DB — admin status can change
 * between logins (env ADMIN_USERNAMES promotion) and a 90-day token must
 * never carry stale privilege. Mount AFTER requireAuth.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next(new AppError('UNAUTHENTICATED', 'a valid bearer token is required'));
    return;
  }
  pool
    .query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [auth.userId])
    .then((result) => {
      const row = result.rows[0];
      if (!row) {
        // Token references a user that no longer exists — re-login required.
        next(new AppError('UNAUTHENTICATED', 'token user no longer exists'));
        return;
      }
      if (!row.is_admin) {
        next(new AppError('FORBIDDEN', 'admin privileges required'));
        return;
      }
      next();
    })
    .catch(next);
}
