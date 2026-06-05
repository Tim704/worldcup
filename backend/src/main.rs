//! World Cup 2026 Fantasy Hub — backend entry point.
//!
//! Boot sequence:
//!   1. Load `.env` (dotenvy) so local dev gets env vars without exporting them.
//!   2. Initialise `tracing-subscriber` with an `EnvFilter` from `RUST_LOG`.
//!   3. Read [`config::Config`] from the environment (CONTRACT §9 names).
//!   4. Build the shared `PgPool` (`db::connect`, max 5 conns for the Pi).
//!   5. Build the Axum `Router`, mount `routes::router(state)` under `/api`,
//!      and layer CORS (permissive in dev) + a request-tracing layer.
//!   6. Bind `APP_BIND_ADDR` and serve with graceful shutdown on Ctrl-C.

// Module declarations — every part of the crate is wired in here.
mod bloodline;
mod config;
mod db;
mod domain;
mod error;
mod routes;
mod scoring;
mod state;

use std::net::SocketAddr;

use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load `.env` if present. Missing file is fine (production uses real env).
    //    We ignore the error deliberately: dotenvy returns Err when there is no
    //    `.env`, which is a normal condition in containerised deployments.
    let _ = dotenvy::dotenv();

    // 2. Tracing: filter from RUST_LOG (CONTRACT §9), defaulting sensibly if
    //    the variable is unset. Format layer logs to stdout.
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,worldcup_hub=debug"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer())
        .init();

    // 3. Configuration from the environment (fail-fast on missing vars).
    let config = Config::from_env()?;
    tracing::info!(bind_addr = %config.bind_addr, "starting worldcup-hub backend");

    // 4. Shared connection pool (one per process; small for the Raspberry Pi).
    let pool = db::connect(&config.database_url).await?;
    tracing::info!("database pool established");

    let state = AppState::new(pool);

    // 5. Router: mount the API under `/api`, plus CORS + request tracing.
    //
    //    CORS is permissive in dev (any origin/method/header) per CONTRACT §6
    //    ("CORS open in dev"). TraceLayer logs each request/response; latencies
    //    appear in milliseconds per the metric logging mandate (CONTRACT §8).
    let app: Router = Router::new()
        .nest("/api", routes::router(state))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    // 6. Bind and serve with graceful shutdown.
    let addr: SocketAddr = config
        .bind_addr
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid APP_BIND_ADDR '{}': {e}", config.bind_addr))?;

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(addr = %addr, "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("shutdown complete");
    Ok(())
}

/// Resolve when the process receives Ctrl-C (SIGINT). Used to trigger a clean,
/// graceful drain of in-flight requests before exit.
async fn shutdown_signal() {
    // Awaiting Ctrl-C is sufficient for a single-binary container; on failure
    // to install the handler we log and simply never resolve (the process can
    // still be killed by the orchestrator).
    match tokio::signal::ctrl_c().await {
        Ok(()) => tracing::info!("received Ctrl-C, shutting down gracefully"),
        Err(err) => tracing::error!(error = %err, "failed to install Ctrl-C handler"),
    }
}
