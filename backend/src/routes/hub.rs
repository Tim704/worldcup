//! Hub endpoint (CONTRACT §6):
//!
//! ```text
//! GET /hub?user_id=:uuid → { upcoming_matches[], standings[], active_forfeits[] }
//! ```
//!
//! The dashboard payload. Each of the three sections is fetched with a SINGLE
//! query (no N+1, CONTRACT §8): upcoming matches by kickoff, group standings
//! aggregated from final results, and the user's live (non-resolved) forfeits.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{Forfeit, Match};
use crate::error::AppError;
use crate::state::AppState;

/// Router fragment for the hub endpoint.
pub fn routes() -> Router<AppState> {
    Router::new().route("/hub", get(hub))
}

/// Query string: the hub is rendered for a specific user.
#[derive(Deserialize)]
struct HubQuery {
    user_id: Uuid,
}

/// One group-standings line item (mirrors the `/standings` shape).
#[derive(Serialize, sqlx::FromRow)]
struct GroupStanding {
    group_label: Option<String>,
    team: String,
    played: i64,
    won: i64,
    drawn: i64,
    lost: i64,
    goals_for: i64,
    goals_against: i64,
    goal_difference: i64,
    points: i64,
}

/// Aggregated hub response.
#[derive(Serialize)]
struct HubResponse {
    /// Next fixtures that have not kicked off yet.
    upcoming_matches: Vec<Match>,
    /// Group standings table.
    standings: Vec<GroupStanding>,
    /// The user's currently-live forfeits (pending/active/unsettled).
    active_forfeits: Vec<Forfeit>,
}

/// Assemble the dashboard from three independent single-shot queries.
///
/// The queries are issued sequentially over the shared pool. Each is a single
/// aggregate/filtered statement, so the whole hub costs three round-trips total
/// regardless of data size — no per-row follow-up queries (no N+1).
async fn hub(
    State(state): State<AppState>,
    Query(q): Query<HubQuery>,
) -> Result<Json<HubResponse>, AppError> {
    // --- 1. Upcoming matches: not yet kicked off, soonest first, capped ------
    let upcoming_matches = sqlx::query_as::<_, Match>(
        "SELECT id, ext_ref, home_team, away_team, group_label, venue, kickoff_at, \
                lock_at, status, home_score, away_score, created_at \
         FROM matches \
         WHERE kickoff_at > now() AND status = 'scheduled' \
         ORDER BY kickoff_at ASC \
         LIMIT 20",
    )
    .fetch_all(&state.pool)
    .await?;

    // --- 2. Standings: same aggregate as /standings (single query) ----------
    let standings = sqlx::query_as::<_, GroupStanding>(
        "WITH appearances AS ( \
             SELECT group_label, home_team AS team, home_score AS gf, away_score AS ga \
             FROM matches \
             WHERE status = 'final' AND home_score IS NOT NULL AND away_score IS NOT NULL \
             UNION ALL \
             SELECT group_label, away_team AS team, away_score AS gf, home_score AS ga \
             FROM matches \
             WHERE status = 'final' AND home_score IS NOT NULL AND away_score IS NOT NULL \
         ) \
         SELECT group_label, \
                team, \
                COUNT(*)::bigint                                   AS played, \
                COUNT(*) FILTER (WHERE gf > ga)::bigint            AS won, \
                COUNT(*) FILTER (WHERE gf = ga)::bigint            AS drawn, \
                COUNT(*) FILTER (WHERE gf < ga)::bigint            AS lost, \
                COALESCE(SUM(gf), 0)::bigint                       AS goals_for, \
                COALESCE(SUM(ga), 0)::bigint                       AS goals_against, \
                COALESCE(SUM(gf - ga), 0)::bigint                  AS goal_difference, \
                (3 * COUNT(*) FILTER (WHERE gf > ga) \
                   + 1 * COUNT(*) FILTER (WHERE gf = ga))::bigint  AS points \
         FROM appearances \
         GROUP BY group_label, team \
         ORDER BY group_label NULLS LAST, points DESC, goal_difference DESC, goals_for DESC, team ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    // --- 3. Active forfeits for this user (anything not yet resolved) --------
    let active_forfeits = sqlx::query_as::<_, Forfeit>(
        "SELECT id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at \
         FROM forfeits \
         WHERE (challenger_id = $1 OR opponent_id = $1) \
           AND state <> 'resolved' \
         ORDER BY created_at DESC",
    )
    .bind(q.user_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(HubResponse {
        upcoming_matches,
        standings,
        active_forfeits,
    }))
}
