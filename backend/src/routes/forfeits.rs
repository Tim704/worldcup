//! The Bloodline — forfeit endpoints (CONTRACT §6):
//!
//! ```text
//! POST /forfeits             {challenger_id, opponent_id, match_id?, stake}  → Forfeit(pending)
//! POST /forfeits/:id/accept  → Forfeit(active)
//! POST /forfeits/:id/decline → Forfeit(resolved)
//! POST /forfeits/:id/settle  {loser_id}                                      → Forfeit(unsettled)
//! POST /forfeits/:id/proof   {proof_url, proof_kind, caption?}  → Forfeit(unsettled)+HallOfShame
//! POST /forfeits/:id/nudge   → Forfeit (nudge or auto-resolve)
//! GET  /forfeits?user_id=:uuid&state= → Forfeit[]
//! ```
//!
//! Every lifecycle endpoint delegates to [`crate::bloodline::apply_transition`]
//! so the state-machine guards live in exactly one place.

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bloodline;
use crate::domain::{Forfeit, ForfeitEvent, ForfeitState, HallEntry, ProofKind};
use crate::error::AppError;
use crate::state::AppState;

/// Router fragment for all forfeit endpoints.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/forfeits", post(create_forfeit))
        .route("/forfeits", get(list_forfeits))
        .route("/forfeits/:id/accept", post(accept_forfeit))
        .route("/forfeits/:id/decline", post(decline_forfeit))
        .route("/forfeits/:id/settle", post(settle_forfeit))
        .route("/forfeits/:id/proof", post(submit_proof))
        .route("/forfeits/:id/nudge", post(nudge_forfeit))
}

// ---------------------------------------------------------------------------
// POST /forfeits  (create, starts in `pending`)
// ---------------------------------------------------------------------------

/// Request body for creating a new forfeit challenge.
#[derive(Deserialize)]
struct CreateForfeit {
    challenger_id: Uuid,
    opponent_id: Uuid,
    /// Optional linked match.
    match_id: Option<Uuid>,
    /// The punishment on the line.
    stake: String,
}

/// Create a forfeit. Validates the two parties differ (the DB also CHECKs
/// this, but we return a clean 400 rather than a 500 from the constraint).
async fn create_forfeit(
    State(state): State<AppState>,
    Json(body): Json<CreateForfeit>,
) -> Result<Json<Forfeit>, AppError> {
    if body.challenger_id == body.opponent_id {
        return Err(AppError::Validation(
            "challenger_id and opponent_id must differ".to_string(),
        ));
    }
    if body.stake.trim().is_empty() {
        return Err(AppError::Validation("stake must not be blank".to_string()));
    }

    // State defaults to 'pending' per the DDL — we let the default apply.
    let row = sqlx::query_as::<_, Forfeit>(
        "INSERT INTO forfeits (challenger_id, opponent_id, match_id, stake) \
         VALUES ($1, $2, $3, $4) \
         RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                   created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
    )
    .bind(body.challenger_id)
    .bind(body.opponent_id)
    .bind(body.match_id)
    .bind(body.stake)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

// ---------------------------------------------------------------------------
// Lifecycle transitions — each delegates to bloodline::apply_transition.
// ---------------------------------------------------------------------------

/// `POST /forfeits/:id/accept` → active.
async fn accept_forfeit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Forfeit>, AppError> {
    let f = bloodline::apply_transition(&state.pool, id, &ForfeitEvent::Accept).await?;
    Ok(Json(f))
}

/// `POST /forfeits/:id/decline` → resolved (declined).
async fn decline_forfeit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Forfeit>, AppError> {
    let f = bloodline::apply_transition(&state.pool, id, &ForfeitEvent::Decline).await?;
    Ok(Json(f))
}

/// Request body for settling a forfeit (the match decided a loser).
#[derive(Deserialize)]
struct SettleBody {
    loser_id: Uuid,
}

/// `POST /forfeits/:id/settle {loser_id}` → unsettled.
async fn settle_forfeit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<SettleBody>,
) -> Result<Json<Forfeit>, AppError> {
    let f = bloodline::apply_transition(
        &state.pool,
        id,
        &ForfeitEvent::Settle {
            loser_id: body.loser_id,
        },
    )
    .await?;
    Ok(Json(f))
}

/// `POST /forfeits/:id/nudge` → unsettled (nudge) or resolved (auto-default).
async fn nudge_forfeit(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Forfeit>, AppError> {
    let f = bloodline::apply_transition(&state.pool, id, &ForfeitEvent::Nudge).await?;
    Ok(Json(f))
}

// ---------------------------------------------------------------------------
// POST /forfeits/:id/proof  → unsettled + creates a HallOfShame row
// ---------------------------------------------------------------------------

/// Request body for submitting proof of an executed punishment.
#[derive(Deserialize)]
struct ProofBody {
    proof_url: String,
    proof_kind: ProofKind,
    caption: Option<String>,
}

/// Combined response: the (still `unsettled`) forfeit plus the freshly created
/// Hall of Shame entry.
#[derive(Serialize)]
struct ProofResponse {
    forfeit: Forfeit,
    hall_entry: HallEntry,
}

/// `POST /forfeits/:id/proof`.
///
/// Order of operations (all inside the same logical request):
///   1. Apply the `SubmitProof` transition (validates the forfeit is
///      `unsettled` and that it exists; self-loop keeps it `unsettled`).
///   2. Derive the `loser_id` for the hall row from the forfeit (must be set
///      by a prior `settle`); reject with 400 if missing.
///   3. Upsert the `hall_of_shame` row keyed by the UNIQUE `forfeit_id` so a
///      re-submitted proof updates the existing ledger entry rather than
///      violating the unique constraint.
async fn submit_proof(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ProofBody>,
) -> Result<Json<ProofResponse>, AppError> {
    if body.proof_url.trim().is_empty() {
        return Err(AppError::Validation(
            "proof_url must not be blank".to_string(),
        ));
    }

    // 1. Validate + self-loop the state machine (also confirms existence).
    let forfeit =
        bloodline::apply_transition(&state.pool, id, &ForfeitEvent::SubmitProof).await?;

    // 2. The hall row requires a non-null loser; it is set during `settle`.
    let loser_id = forfeit.loser_id.ok_or_else(|| {
        AppError::Validation(
            "forfeit has no loser_id yet; settle it before submitting proof".to_string(),
        )
    })?;

    // 3. Upsert the proof ledger entry (UNIQUE forfeit_id is the conflict key).
    let hall_entry = sqlx::query_as::<_, HallEntry>(
        "INSERT INTO hall_of_shame (forfeit_id, loser_id, proof_url, proof_kind, caption) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (forfeit_id) DO UPDATE \
         SET loser_id   = EXCLUDED.loser_id, \
             proof_url  = EXCLUDED.proof_url, \
             proof_kind = EXCLUDED.proof_kind, \
             caption    = EXCLUDED.caption \
         RETURNING id, forfeit_id, loser_id, proof_url, proof_kind, caption, verified, created_at",
    )
    .bind(forfeit.id)
    .bind(loser_id)
    .bind(body.proof_url)
    .bind(body.proof_kind)
    .bind(body.caption)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ProofResponse {
        forfeit,
        hall_entry,
    }))
}

// ---------------------------------------------------------------------------
// GET /forfeits?user_id=:uuid&state=
// ---------------------------------------------------------------------------

/// Query string for listing forfeits. `user_id` is required; `state` filters
/// optionally on the lifecycle state.
#[derive(Deserialize)]
struct ListQuery {
    user_id: Uuid,
    /// Optional state filter (`pending` | `active` | `unsettled` | `resolved`).
    state: Option<ForfeitState>,
}

/// List forfeits a user participates in (as challenger OR opponent),
/// optionally filtered by state. A single query with an OR predicate avoids
/// any N+1.
async fn list_forfeits(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Forfeit>>, AppError> {
    // We pass the optional state filter as a nullable bind and let SQL treat
    // NULL as "no filter" via `($2 IS NULL OR state = $2)`. This keeps it to
    // one prepared statement regardless of whether a filter was supplied.
    let rows = sqlx::query_as::<_, Forfeit>(
        "SELECT id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at \
         FROM forfeits \
         WHERE (challenger_id = $1 OR opponent_id = $1) \
           AND ($2::forfeit_state IS NULL OR state = $2::forfeit_state) \
         ORDER BY created_at DESC",
    )
    .bind(q.user_id)
    .bind(q.state)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}
