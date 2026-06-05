//! Prediction endpoints (CONTRACT §6):
//!
//! ```text
//! POST /predictions               upsert {user_id, match_id, outcome, exact_home?, exact_away?}
//!                                 server REJECTS writes when now ≥ matches.lock_at (HTTP 409)
//! GET  /predictions?user_id=:uuid → Prediction[]
//! ```
//!
//! The lock rule is enforced by SELECTing the match's `lock_at` and comparing
//! against the DB clock (`now()`), so Rust never disagrees with Postgres about
//! "now" or about the generated lock column.

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::{Outcome1x2, Prediction};
use crate::error::AppError;
use crate::state::AppState;

/// Router fragment for prediction endpoints.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/predictions", post(upsert_prediction))
        .route("/predictions", get(list_predictions))
}

// ---------------------------------------------------------------------------
// POST /predictions  (upsert)
// ---------------------------------------------------------------------------

/// Request body for upserting a prediction.
#[derive(Deserialize)]
struct UpsertPrediction {
    user_id: Uuid,
    match_id: Uuid,
    outcome: Outcome1x2,
    /// Optional exact-score components (SMALLINT → i16).
    exact_home: Option<i16>,
    exact_away: Option<i16>,
}

/// Upsert a user's prediction for a match, honouring the lock window.
///
/// Steps:
///   1. Look up the match's generated `lock_at` and ask Postgres whether
///      `now() >= lock_at`. If the match is missing → 404. If locked → 409
///      (`AppError::Locked`).
///   2. INSERT … ON CONFLICT (user_id, match_id) DO UPDATE to upsert, bumping
///      `updated_at`. The UNIQUE(user_id, match_id) constraint backs the
///      conflict target.
async fn upsert_prediction(
    State(state): State<AppState>,
    Json(body): Json<UpsertPrediction>,
) -> Result<Json<Prediction>, AppError> {
    // --- 1. Lock check, computed by the database clock ----------------------
    // Returns the boolean `is_locked = (now() >= lock_at)`; `fetch_optional`
    // distinguishes "match not found" (None → 404) from a real row.
    let locked: bool = sqlx::query_scalar::<_, bool>(
        "SELECT (now() >= lock_at) FROM matches WHERE id = $1",
    )
    .bind(body.match_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if locked {
        // Predictions are immutable once the match locks (60 s before kickoff).
        return Err(AppError::Locked);
    }

    // --- 2. Upsert ----------------------------------------------------------
    let row = sqlx::query_as::<_, Prediction>(
        "INSERT INTO predictions (user_id, match_id, outcome, exact_home, exact_away) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (user_id, match_id) DO UPDATE \
         SET outcome    = EXCLUDED.outcome, \
             exact_home = EXCLUDED.exact_home, \
             exact_away = EXCLUDED.exact_away, \
             updated_at = now() \
         RETURNING id, user_id, match_id, outcome, exact_home, exact_away, \
                   is_locked, points_awarded, created_at, updated_at",
    )
    .bind(body.user_id)
    .bind(body.match_id)
    .bind(body.outcome)
    .bind(body.exact_home)
    .bind(body.exact_away)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

// ---------------------------------------------------------------------------
// GET /predictions?user_id=:uuid
// ---------------------------------------------------------------------------

/// Query string for listing a user's predictions.
#[derive(Deserialize)]
struct ListQuery {
    user_id: Uuid,
}

/// List all predictions for a user, newest match first.
async fn list_predictions(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Prediction>>, AppError> {
    let rows = sqlx::query_as::<_, Prediction>(
        "SELECT p.id, p.user_id, p.match_id, p.outcome, p.exact_home, p.exact_away, \
                p.is_locked, p.points_awarded, p.created_at, p.updated_at \
         FROM predictions p \
         JOIN matches m ON m.id = p.match_id \
         WHERE p.user_id = $1 \
         ORDER BY m.kickoff_at ASC",
    )
    .bind(q.user_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}
