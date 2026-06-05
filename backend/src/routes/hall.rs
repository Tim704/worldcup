//! Hall of Shame / tribunal endpoints (CONTRACT §6):
//!
//! ```text
//! GET  /hall                      → HallEntry[]   (with vote tallies)
//! POST /hall/:entryId/vote        {voter_id, vote: 1|-1}  → tallies; may flip verified + resolve forfeit
//! ```
//!
//! Voting logic: upsert the voter's single ballot, recompute the NET tally
//! (sum of +1 / -1 votes), and when `net >= TRIBUNAL_NET_VOTES` flip
//! `hall_of_shame.verified = true` AND resolve the linked forfeit via the
//! Bloodline state machine (`TribunalPass`).

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bloodline::{self, TRIBUNAL_NET_VOTES};
use crate::domain::{ForfeitEvent, ForfeitState, ProofKind};
use crate::error::AppError;
use crate::state::AppState;

/// Router fragment for Hall of Shame endpoints.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/hall", get(list_hall))
        .route("/hall/:entryId/vote", post(vote))
}

// ---------------------------------------------------------------------------
// GET /hall  — entries with their vote tallies (single aggregate query)
// ---------------------------------------------------------------------------

/// A Hall of Shame entry enriched with its tribunal vote tallies.
///
/// `up`, `down` and `net` are aggregated in the SAME query via a LEFT JOIN to
/// `shame_votes`, so listing the whole hall is one round-trip (no N+1).
#[derive(Serialize, sqlx::FromRow)]
struct HallEntryWithTally {
    id: Uuid,
    forfeit_id: Uuid,
    loser_id: Uuid,
    proof_url: String,
    proof_kind: ProofKind,
    caption: Option<String>,
    verified: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    /// Count of +1 votes.
    up: i64,
    /// Count of -1 votes.
    down: i64,
    /// Net tally (up − down).
    net: i64,
}

/// List all Hall of Shame entries with vote tallies, newest first.
async fn list_hall(
    State(state): State<AppState>,
) -> Result<Json<Vec<HallEntryWithTally>>, AppError> {
    let rows = sqlx::query_as::<_, HallEntryWithTally>(
        "SELECT h.id, h.forfeit_id, h.loser_id, h.proof_url, h.proof_kind, \
                h.caption, h.verified, h.created_at, \
                COALESCE(SUM(CASE WHEN v.vote =  1 THEN 1 ELSE 0 END), 0)::bigint AS up, \
                COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END), 0)::bigint AS down, \
                COALESCE(SUM(v.vote), 0)::bigint                                  AS net \
         FROM hall_of_shame h \
         LEFT JOIN shame_votes v ON v.entry_id = h.id \
         GROUP BY h.id, h.forfeit_id, h.loser_id, h.proof_url, h.proof_kind, \
                  h.caption, h.verified, h.created_at \
         ORDER BY h.created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// POST /hall/:entryId/vote
// ---------------------------------------------------------------------------

/// Request body for casting (or changing) a tribunal vote.
#[derive(Deserialize)]
struct VoteBody {
    voter_id: Uuid,
    /// Must be exactly +1 or -1 (also CHECKed by the DB).
    vote: i16,
}

/// Response after a vote: the recomputed tally and whether this vote flipped
/// the entry to verified (and thus resolved the forfeit).
#[derive(Serialize)]
struct VoteResponse {
    entry_id: Uuid,
    up: i64,
    down: i64,
    net: i64,
    verified: bool,
    /// True iff THIS request crossed the threshold and resolved the forfeit.
    resolved_forfeit: bool,
}

/// Cast a tribunal vote, recompute the net tally, and — when the net reaches
/// [`TRIBUNAL_NET_VOTES`] — verify the entry and resolve the linked forfeit.
///
/// Idempotent per voter: the UNIQUE(entry_id, voter_id) constraint backs an
/// upsert so re-voting overwrites the prior ballot rather than stacking.
async fn vote(
    State(state): State<AppState>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<VoteBody>,
) -> Result<Json<VoteResponse>, AppError> {
    // Validate the vote value up front for a clean 400 (DB CHECK is the backstop).
    if body.vote != 1 && body.vote != -1 {
        return Err(AppError::Validation("vote must be +1 or -1".to_string()));
    }

    // Run the whole read-modify-write in one transaction so the tally we act on
    // is consistent with the ballot we just recorded.
    let mut tx = state.pool.begin().await?;

    // Confirm the entry exists and capture its forfeit_id + current verified
    // flag. 404 if it does not.
    let (forfeit_id, already_verified): (Uuid, bool) = sqlx::query_as::<_, (Uuid, bool)>(
        "SELECT forfeit_id, verified FROM hall_of_shame WHERE id = $1",
    )
    .bind(entry_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    // Upsert this voter's ballot (one vote per voter per entry).
    sqlx::query(
        "INSERT INTO shame_votes (entry_id, voter_id, vote) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (entry_id, voter_id) DO UPDATE SET vote = EXCLUDED.vote",
    )
    .bind(entry_id)
    .bind(body.voter_id)
    .bind(body.vote)
    .execute(&mut *tx)
    .await?;

    // Recompute the tally from scratch (authoritative; avoids drift).
    let (up, down, net): (i64, i64, i64) = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT \
            COALESCE(SUM(CASE WHEN vote =  1 THEN 1 ELSE 0 END), 0)::bigint AS up, \
            COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0)::bigint AS down, \
            COALESCE(SUM(vote), 0)::bigint                                  AS net \
         FROM shame_votes WHERE entry_id = $1",
    )
    .bind(entry_id)
    .fetch_one(&mut *tx)
    .await?;

    // Decide whether this vote crossed the tribunal threshold for the FIRST
    // time. We only resolve the forfeit on the crossing edge to keep the
    // Bloodline transition legal (it must come from `unsettled`).
    let mut verified = already_verified;
    let mut resolved_forfeit = false;

    if !already_verified && net >= TRIBUNAL_NET_VOTES {
        // Flip the entry to verified within this transaction.
        sqlx::query("UPDATE hall_of_shame SET verified = true WHERE id = $1")
            .bind(entry_id)
            .execute(&mut *tx)
            .await?;
        verified = true;
    }

    // Commit the vote + verified flip before touching the state machine. The
    // Bloodline wrapper runs its own transaction, so we finish ours first to
    // avoid nested-transaction surprises while keeping the ballot durable.
    tx.commit().await?;

    // On the crossing edge, resolve the forfeit via the state machine, but
    // only if it is actually still `unsettled` (a `nudge` auto-default could
    // have resolved it first — in which case we leave it alone and do not
    // error). We check the current state, then issue `TribunalPass`.
    if verified && !already_verified {
        let current_state: Option<ForfeitState> = sqlx::query_scalar::<_, ForfeitState>(
            "SELECT state FROM forfeits WHERE id = $1",
        )
        .bind(forfeit_id)
        .fetch_optional(&state.pool)
        .await?;

        if matches!(current_state, Some(ForfeitState::Unsettled)) {
            bloodline::apply_transition(
                &state.pool,
                forfeit_id,
                &ForfeitEvent::TribunalPass,
            )
            .await?;
            resolved_forfeit = true;
        }
    }

    Ok(Json(VoteResponse {
        entry_id,
        up,
        down,
        net,
        verified,
        resolved_forfeit,
    }))
}
