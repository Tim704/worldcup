//! HTTP route assembly.
//!
//! Each endpoint group from CONTRACT §6 lives in its own submodule. This module
//! merges those submodule routers into one and attaches the shared
//! [`AppState`]. The result is mounted under `/api` in `main.rs`.

use axum::Router;

use crate::state::AppState;

pub mod forfeits;
pub mod hall;
pub mod health;
pub mod hub;
pub mod matches;
pub mod predictions;

/// Build the complete API router with shared state attached.
///
/// The submodule routers are defined generically over `AppState` (each returns
/// `Router<AppState>`); we merge them and call `.with_state(state)` exactly
/// once here so there is a single source of state for the whole tree.
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(health::routes())
        .merge(hub::routes())
        .merge(matches::routes())
        .merge(predictions::routes())
        .merge(forfeits::routes())
        .merge(hall::routes())
        .with_state(state)
}
