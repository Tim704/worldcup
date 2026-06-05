//! The single application error type and its HTTP rendering.
//!
//! Per CONTRACT §8 there is exactly ONE `AppError` enum (built with
//! `thiserror`) that implements `IntoResponse`. Every fallible handler returns
//! `Result<_, AppError>` so that error → HTTP-status → JSON mapping lives in
//! one place. The JSON body shape is fixed by CONTRACT §6:
//!
//! ```json
//! { "error": { "code": "...", "message": "..." } }
//! ```

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Unified error type for the whole backend.
///
/// Status-code mapping (CONTRACT §6/§8):
///   * `NotFound`           → 404
///   * `Validation`         → 400
///   * `Locked`             → 409 (predictions after `lock_at`)
///   * `IllegalTransition`  → 409 (Bloodline state machine rejected the event)
///   * `Db` / `Internal`    → 500
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Any error bubbling up from SQLx (connection, query, decode, …).
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    /// A requested entity does not exist.
    #[error("not found")]
    NotFound,

    /// Caller-supplied input failed validation; carries a human message.
    #[error("validation error: {0}")]
    Validation(String),

    /// A write was attempted after the prediction lock (now ≥ lock_at).
    #[error("locked")]
    Locked,

    /// The Bloodline state machine rejected an event for the current state.
    /// `from` is the current state name, `event` is the attempted event name.
    #[error("illegal transition from '{from}' on event '{event}'")]
    IllegalTransition { from: String, event: String },

    /// Catch-all for unexpected internal failures; carries a message.
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    /// Map each variant to its HTTP status and a stable machine-readable
    /// `code` string (used by the frontend to branch on error kinds).
    fn parts(&self) -> (StatusCode, &'static str) {
        match self {
            AppError::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "db_error"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            AppError::Validation(_) => (StatusCode::BAD_REQUEST, "validation"),
            AppError::Locked => (StatusCode::CONFLICT, "locked"),
            AppError::IllegalTransition { .. } => {
                (StatusCode::CONFLICT, "illegal_transition")
            }
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

/// Render an `AppError` as the contract-mandated JSON envelope + status code.
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.parts();
        // `self.to_string()` uses the `#[error("…")]` display strings above,
        // giving a useful human-readable `message` field.
        let message = self.to_string();

        // Log server-side faults at error level (these indicate bugs/outages);
        // client faults are expected and stay quieter.
        if status.is_server_error() {
            tracing::error!(error.code = code, error.message = %message, "request failed");
        } else {
            tracing::debug!(error.code = code, error.message = %message, "request rejected");
        }

        let body = Json(json!({
            "error": {
                "code": code,
                "message": message,
            }
        }));

        (status, body).into_response()
    }
}
