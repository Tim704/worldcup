/**
 * db.ts — the ONE shared PostgreSQL connection pool (Contract §2).
 *
 * - No ORM. Raw SQL only, always parameterised ($1-style binds).
 * - `max: 5` connections — Pi-sized; the Raspberry Pi 4/5 deployment caps the
 *   db container at 512 MiB, so we keep the connection footprint tiny.
 * - `DATABASE_URL` comes from the environment (e.g.
 *   postgres://wc:wc@db:5432/worldcup). When it is unset, `pg` falls back to
 *   its standard PG* environment variables / libpq defaults, which keeps
 *   local development flexible.
 *
 * Everything in the app — migrations, routes, the admin settlement
 * transaction — goes through this single pool. Never instantiate another.
 */
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // hard cap — Pi-sized (Contract §2)
});

// Pool-level errors (e.g. a backend connection dropped while idle) must not
// crash the process; log them and let the pool replace the connection.
pool.on('error', (err: Error) => {
  console.error(`[db] idle client error: ${err.message}`);
});
