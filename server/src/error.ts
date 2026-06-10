/**
 * error.ts — the single error vocabulary of the API (Contract §6).
 *
 * Every error the API emits is the envelope:
 *
 *     { "error": { "code": "...", "message": "..." } }
 *
 * produced by exactly one AppError class + one Express error middleware.
 * The full set of codes and their HTTP statuses (do not invent more):
 *
 *     VALIDATION      400   bad input shape / range / format
 *     UNAUTHENTICATED 401   missing / invalid / expired token
 *     FORBIDDEN       403   authenticated but not allowed (e.g. not admin)
 *     NOT_FOUND       404   no such resource / route
 *     MATCH_LOCKED    409   action arrived at/after lock_at (or before, for
 *                           the predictions-privacy listing)
 *     WAGER_CONFLICT  409   wager state machine refused the transition
 *     INTERNAL        500   anything unexpected
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'MATCH_LOCKED'
  | 'WAGER_CONFLICT'
  | 'INTERNAL';

/** HTTP status for each error code — fixed mapping, exhaustively typed. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  MATCH_LOCKED: 409,
  WAGER_CONFLICT: 409,
  INTERNAL: 500,
};

/** The one throwable error type route handlers use. */
export class AppError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }

  /** HTTP status derived from the code — never set independently. */
  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

/**
 * Wrap an async route handler so a rejected promise reaches the error
 * middleware. Express 4 does NOT forward async rejections by itself — every
 * async handler in src/routes/ goes through this.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * The ONE Express error middleware. Mounted last in index.ts.
 *
 * - AppError → its mapped status + the envelope.
 * - express.json() syntax errors (malformed request body) → VALIDATION 400.
 * - Anything else → logged with stack, generic INTERNAL 500 (no internals leak).
 *
 * NOTE: Express recognises error middleware by arity — the signature MUST
 * keep all four parameters even though `next` is unused (hence the `_` prefix).
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // express.json() throws a SyntaxError (with a `body` property) on malformed
  // JSON — that is the caller's fault, not ours: report it as VALIDATION.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'malformed JSON body' } });
    return;
  }

  // Unexpected: log the full stack server-side, return a generic envelope.
  console.error('[error] unhandled:', err instanceof Error ? err.stack ?? err.message : err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'internal server error' } });
}
