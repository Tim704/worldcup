//! Shared application state injected into every Axum handler.
//!
//! Axum clones the state per request, so it must be cheap to clone. `PgPool`
//! is internally reference-counted (`Arc`-backed), so cloning the pool just
//! bumps a refcount — all clones share the SAME underlying connection pool
//! (CONTRACT §8: "one shared `PgPool`").

use sqlx::postgres::PgPool;

/// Process-wide state handed to handlers via `axum::extract::State`.
#[derive(Clone)]
pub struct AppState {
    /// The single shared Postgres connection pool.
    pub pool: PgPool,
}

impl AppState {
    /// Construct the state from an already-built pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
