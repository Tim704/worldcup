/**
 * migrate.ts — plain-SQL migrations, applied automatically on boot (Contract §2).
 *
 * Mechanics:
 * - Connect-retry loop: 30 attempts × 2 s (60 s total budget) so the Pi's
 *   slow Postgres start never kills the container.
 * - Bookkeeping in `schema_migrations(version, applied_at)`.
 * - Migration files are the `.sql` files in server/migrations/, EXCLUDING
 *   `.down.sql` reversals, applied in lexicographic (sorted) order.
 * - Each file runs inside its own transaction; failure rolls back and aborts
 *   boot (a half-applied schema must never serve traffic).
 * - Idempotent: already-recorded versions are skipped, and a session-level
 *   advisory lock serialises concurrent migrators (e.g. an overlapping
 *   restart) so the same file can never apply twice.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { pool } from './db.js';

/**
 * server/migrations/ relative to THIS module: works both from src/ (tsx dev)
 * and from dist/ (compiled runtime image, where the Dockerfile copies
 * migrations/ alongside dist/).
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Arbitrary but fixed app-wide advisory lock key for the migration phase. */
const MIGRATION_LOCK_KEY = 727_274;

/** Connect-retry parameters — 30 attempts × 2 s (2000 ms) each, per contract. */
const CONNECT_ATTEMPTS = 30;
const CONNECT_RETRY_DELAY_MS = 2000;

/**
 * Block until Postgres answers a trivial query, retrying for up to
 * CONNECT_ATTEMPTS × CONNECT_RETRY_DELAY_MS = 60 s. Throws when the budget
 * is exhausted so the container exits non-zero and Docker restarts it.
 */
async function waitForDb(): Promise<void> {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log(`[migrate] database reachable (attempt ${attempt}/${CONNECT_ATTEMPTS})`);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[migrate] database not ready (attempt ${attempt}/${CONNECT_ATTEMPTS}): ${message} — retrying in ${CONNECT_RETRY_DELAY_MS} ms`,
      );
      if (attempt === CONNECT_ATTEMPTS) {
        throw new Error(
          `database unreachable after ${CONNECT_ATTEMPTS} attempts (${(CONNECT_ATTEMPTS * CONNECT_RETRY_DELAY_MS) / 1000} s)`,
        );
      }
      await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }
}

/** Apply all pending migrations. Called once from index.ts before listen(). */
export async function runMigrations(): Promise<void> {
  await waitForDb();

  const client = await pool.connect();
  try {
    // Serialise concurrent migrators (session-level lock, released on disconnect).
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Up-migrations only: *.sql minus *.down.sql, lexicographically sorted so
    // 0001_… runs before 0002_… and so on.
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const seen = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if ((seen.rowCount ?? 0) > 0) {
        console.log(`[migrate] ${version} already applied — skipping`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const startedNs = process.hrtime.bigint();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
        console.log(`[migrate] applied ${version} in ${elapsedMs.toFixed(1)} ms`);
      } catch (err) {
        await client.query('ROLLBACK');
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`migration ${version} failed (rolled back): ${message}`);
      }
    }

    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  } finally {
    client.release();
  }
}
