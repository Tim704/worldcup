//! `GET /health` — liveness probe (CONTRACT §6).
//!
//! Returns `{ status, uptime_secs }`. The uptime is measured in metric SI
//! seconds from process start. We capture the start instant once via a
//! process-lifetime `OnceLock` so the handler stays cheap and stateless.

use std::sync::OnceLock;
use std::time::Instant;

use axum::{routing::get, Json, Router};
use serde::Serialize;

use crate::state::AppState;

/// Process start time, set on first access. `Instant` is monotonic, so the
/// derived uptime is immune to wall-clock adjustments (NTP steps, etc.).
static START: OnceLock<Instant> = OnceLock::new();

/// JSON body for the health endpoint.
#[derive(Serialize)]
struct Health {
    /// Always `"ok"` while the process can serve requests.
    status: &'static str,
    /// Seconds (metric SI) since process start.
    uptime_secs: u64,
}

/// Router fragment for the health endpoint.
pub fn routes() -> Router<AppState> {
    // Initialise the start clock as the router is built (process boot).
    START.get_or_init(Instant::now);
    Router::new().route("/health", get(health))
}

/// Handler: report liveness and uptime in seconds.
async fn health() -> Json<Health> {
    let start = START.get_or_init(Instant::now);
    Json(Health {
        status: "ok",
        uptime_secs: start.elapsed().as_secs(),
    })
}
