/**
 * index.ts — boot sequence (Contract §6, §8).
 *
 *   dotenv → migrate (with 30 × 2 s connect retry) → mount → listen.
 *
 * - PORT (default 8080) — the nginx proxy and compose healthcheck expect it.
 * - APP_SECRET signs the HS256 JWTs; when unset we WARN LOUDLY and fall back
 *   to the dev secret 'dev-secret-change-me' (tokens are forgeable!).
 * - CORS is open; bodies are parsed by express.json().
 * - One structured log line per request: method, path, status, latency in ms.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runMigrations } from './migrate.js';
import { AppError, errorMiddleware } from './error.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import predictionsRouter from './routes/predictions.js';
import leaderboardRouter from './routes/leaderboard.js';
import wagersRouter from './routes/wagers.js';
import adminRouter from './routes/admin.js';

/** Build the fully-wired Express app (exported shape kept simple for tests). */
function buildApp(): express.Express {
  const app = express();

  // Open CORS + JSON bodies (Contract §6).
  app.use(cors());
  app.use(express.json());

  // Structured request log: one JSON line per request with the latency in
  // milliseconds (metric/SI — measured with the monotonic ns clock).
  app.use((req, res, next) => {
    const startedNs = process.hrtime.bigint();
    res.on('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
      console.log(
        JSON.stringify({
          msg: 'request',
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          latency_ms: Math.round(latencyMs * 10) / 10, // 0.1 ms resolution
        }),
      );
    });
    next();
  });

  // The API surface (Contract §6) — base /api.
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/matches', matchesRouter);
  app.use('/api/predictions', predictionsRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/wagers', wagersRouter);
  app.use('/api/admin', adminRouter);

  // Unknown route → the standard NOT_FOUND envelope.
  app.use((req, _res, next) => {
    next(new AppError('NOT_FOUND', `no route: ${req.method} ${req.path}`));
  });

  // The ONE error middleware — always last.
  app.use(errorMiddleware);

  return app;
}

async function main(): Promise<void> {
  // Loud, unmissable warning when the JWT secret is missing (Contract §8).
  if (!process.env.APP_SECRET) {
    const bar = '!'.repeat(72);
    console.warn(bar);
    console.warn('!! APP_SECRET is UNSET — falling back to the dev secret');
    console.warn("!! 'dev-secret-change-me'. Every token is FORGEABLE.");
    console.warn('!! Set APP_SECRET before any real deployment.');
    console.warn(bar);
  }

  // Apply migrations before accepting traffic (includes the 30 × 2 s
  // connect-retry loop so the Pi's slow Postgres start never kills us).
  await runMigrations();

  const port = Number(process.env.PORT ?? 8080);
  const app = buildApp();
  app.listen(port, () => {
    console.log(`[boot] the almanac cup api listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('[boot] fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
