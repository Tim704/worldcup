//! Database connectivity: a single shared `PgPool` for the whole process.
//!
//! Connection-pooling rationale (CONTRACT §8 — "tuned small for the Pi"):
//! the deployment target is a Raspberry Pi 4/5 running `postgres:16-alpine`.
//! Postgres allocates roughly one backend process (and a chunk of work_mem)
//! per live connection, so on a memory-constrained single-board computer a
//! large pool is actively harmful — it would let a burst of requests spawn
//! dozens of Postgres backends and push the Pi into swap. The Axum handlers
//! are short-lived and I/O-bound, so a small pool (5) keeps a handful of
//! warm connections ready while bounding peak memory. Requests that arrive
//! when all 5 are busy simply wait briefly for one to free up — back-pressure
//! we want, rather than unbounded fan-out.

use sqlx::postgres::{PgPool, PgPoolOptions};

/// Maximum number of physical Postgres connections held by the pool.
///
/// Deliberately small (5) to fit the Raspberry Pi memory budget. See the
/// module-level rationale above. One process == one pool == this many
/// backends, max.
const MAX_CONNECTIONS: u32 = 5;

/// Build the shared connection pool.
///
/// Returns an error (propagated to `main`) if the initial connection cannot
/// be established, so the process fails fast on a misconfigured `DATABASE_URL`
/// instead of limping along and erroring on the first request.
pub async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        // Cap concurrent Postgres backends — see rationale above.
        .max_connections(MAX_CONNECTIONS)
        .connect(database_url)
        .await?;

    Ok(pool)
}
