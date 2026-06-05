//! Match endpoints (CONTRACT §6):
//!
//! ```text
//! GET /matches      → Match[]
//! GET /matches/:id  → Match
//! GET /standings    → GroupStanding[]
//! GET /leaderboard  → LeaderboardRow[]  (Elo + points)
//! ```
//!
//! `standings` and `leaderboard` are written as SINGLE aggregate queries to
//! avoid N+1 (CONTRACT §8).

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use uuid::Uuid;

use crate::domain::Match;
use crate::error::AppError;
use crate::state::AppState;

/// Router fragment for match/standings/leaderboard endpoints.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/matches", get(list_matches))
        .route("/matches/:id", get(get_match))
        .route("/standings", get(standings))
        .route("/leaderboard", get(leaderboard))
}

// ---------------------------------------------------------------------------
// GET /matches
// ---------------------------------------------------------------------------

/// List all matches, ordered by kickoff time ascending.
async fn list_matches(
    State(state): State<AppState>,
) -> Result<Json<Vec<Match>>, AppError> {
    let rows = sqlx::query_as::<_, Match>(
        "SELECT id, ext_ref, home_team, away_team, group_label, venue, kickoff_at, \
                lock_at, status, home_score, away_score, created_at \
         FROM matches \
         ORDER BY kickoff_at ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// GET /matches/:id
// ---------------------------------------------------------------------------

/// Fetch a single match by id, or 404.
async fn get_match(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Match>, AppError> {
    let row = sqlx::query_as::<_, Match>(
        "SELECT id, ext_ref, home_team, away_team, group_label, venue, kickoff_at, \
                lock_at, status, home_score, away_score, created_at \
         FROM matches WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

// ---------------------------------------------------------------------------
// GET /standings
// ---------------------------------------------------------------------------

/// One group-standings line item.
///
/// Aggregated from FINAL matches: a 3-1-0 (win-draw-loss) points model with
/// goals-for / goals-against / goal-difference per team within its group.
#[derive(Serialize, sqlx::FromRow)]
struct GroupStanding {
    /// Group label, e.g. "GROUP F". May be NULL for ungrouped fixtures.
    group_label: Option<String>,
    /// Team name.
    team: String,
    /// Matches played (final only).
    played: i64,
    /// Wins.
    won: i64,
    /// Draws.
    drawn: i64,
    /// Losses.
    lost: i64,
    /// Goals scored.
    goals_for: i64,
    /// Goals conceded.
    goals_against: i64,
    /// Goal difference (goals_for − goals_against).
    goal_difference: i64,
    /// Competition points (3·won + 1·drawn).
    points: i64,
}

/// Compute group standings in a SINGLE aggregate query (no N+1).
///
/// Strategy: build a per-team "appearance" relation by UNION-ing each final
/// match from the home side and the away side, then `GROUP BY` group + team.
/// This keeps everything in one round-trip and lets Postgres do the math.
async fn standings(
    State(state): State<AppState>,
) -> Result<Json<Vec<GroupStanding>>, AppError> {
    let rows = sqlx::query_as::<_, GroupStanding>(
        // The CTE `appearances` emits one row per (team, match) with that
        // team's own scored/conceded goals and an outcome flag. We then
        // aggregate. Only `status = 'final'` matches contribute.
        "WITH appearances AS ( \
             SELECT group_label, home_team AS team, \
                    home_score AS gf, away_score AS ga \
             FROM matches \
             WHERE status = 'final' AND home_score IS NOT NULL AND away_score IS NOT NULL \
             UNION ALL \
             SELECT group_label, away_team AS team, \
                    away_score AS gf, home_score AS ga \
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

    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
// GET /leaderboard
// ---------------------------------------------------------------------------

/// One leaderboard row: a user ranked by Elo and season points.
#[derive(Serialize, sqlx::FromRow)]
struct LeaderboardRow {
    user_id: Uuid,
    username: String,
    display_name: String,
    elo_rating: i32,
    total_points: i32,
    /// Number of predictions the user has placed (single-join aggregate).
    predictions_made: i64,
    /// 1-based standing position (Elo desc, then points desc) via window function.
    rank: i64,
}

/// Leaderboard in a SINGLE query with a LEFT JOIN aggregate (no N+1).
///
/// We join users to their predictions and `COUNT` per user. Ordering is by
/// Elo then total points then username for stable tie-breaks.
async fn leaderboard(
    State(state): State<AppState>,
) -> Result<Json<Vec<LeaderboardRow>>, AppError> {
    let rows = sqlx::query_as::<_, LeaderboardRow>(
        "SELECT u.id AS user_id, u.username, u.display_name, \
                u.elo_rating, u.total_points, \
                COUNT(p.id)::bigint AS predictions_made, \
                ROW_NUMBER() OVER (ORDER BY u.elo_rating DESC, u.total_points DESC, u.username ASC)::bigint AS rank \
         FROM users u \
         LEFT JOIN predictions p ON p.user_id = u.id \
         GROUP BY u.id, u.username, u.display_name, u.elo_rating, u.total_points \
         ORDER BY u.elo_rating DESC, u.total_points DESC, u.username ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}
