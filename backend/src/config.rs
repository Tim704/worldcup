//! Application configuration loaded from the process environment.
//!
//! All environment variable NAMES are fixed by CONTRACT §9 and must not drift:
//!   * `DATABASE_URL`   — Postgres connection string (shared with the ingest svc)
//!   * `APP_BIND_ADDR`  — `host:port` the Axum server binds (e.g. `0.0.0.0:8080`)
//!
//! Loading is fail-fast: a missing required variable yields a clear,
//! actionable error string rather than a panic deep inside startup.

use std::env;

/// Strongly-typed view of the runtime configuration.
///
/// Constructed once at boot (`Config::from_env`) and then handed to the parts
/// of the system that need it. Cloneable because the values are cheap `String`s.
#[derive(Debug, Clone)]
pub struct Config {
    /// Postgres DSN, e.g. `postgres://wc:wc@db:5432/worldcup`.
    pub database_url: String,
    /// Socket address the HTTP server listens on, e.g. `0.0.0.0:8080`.
    pub bind_addr: String,
}

impl Config {
    /// Read configuration from the environment.
    ///
    /// `dotenvy` is expected to have already populated the environment from a
    /// `.env` file (done in `main`). We return a descriptive `anyhow::Error`
    /// for any missing required variable so the operator immediately knows
    /// which env var to set.
    pub fn from_env() -> anyhow::Result<Self> {
        // DATABASE_URL is mandatory — without it there is nothing to serve.
        let database_url = env::var("DATABASE_URL").map_err(|_| {
            anyhow::anyhow!(
                "missing required env var DATABASE_URL \
                 (expected e.g. postgres://wc:wc@db:5432/worldcup)"
            )
        })?;

        // APP_BIND_ADDR is mandatory; we do not silently default the bind
        // address so deployments are explicit about where they listen.
        let bind_addr = env::var("APP_BIND_ADDR").map_err(|_| {
            anyhow::anyhow!(
                "missing required env var APP_BIND_ADDR \
                 (expected e.g. 0.0.0.0:8080)"
            )
        })?;

        Ok(Self {
            database_url,
            bind_addr,
        })
    }
}
