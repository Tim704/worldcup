//! Domain types — Rust mirrors of the canonical schema in
//! `backend/migrations/0001_init.sql` (CONTRACT §3).
//!
//! Field names are snake_case and match the SQL columns EXACTLY so that
//! `#[derive(sqlx::FromRow)]` maps rows by name with zero manual plumbing, and
//! so serde (with `serde(rename_all = "lowercase")` on enums) produces the
//! API JSON the frontend expects.
//!
//! Enum ↔ Postgres mapping uses `#[sqlx(type_name = "<pg_enum>")]` +
//! `rename_all = "lowercase"`, which makes each Rust variant encode/decode to
//! the matching lowercase Postgres enum label.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===========================================================================
// Enumerations (mirror the CREATE TYPE … AS ENUM declarations)
// ===========================================================================

/// `outcome_1x2 AS ENUM ('home', 'draw', 'away')` — the 1X2 market result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "outcome_1x2", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Outcome1x2 {
    /// Home team wins.
    Home,
    /// Draw.
    Draw,
    /// Away team wins.
    Away,
}

/// `match_status AS ENUM ('scheduled', 'live', 'final')`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "match_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MatchStatus {
    /// Not started yet.
    Scheduled,
    /// In progress.
    Live,
    /// Completed; score is final.
    Final,
}

/// `proof_kind AS ENUM ('image', 'video', 'link')` — Hall of Shame evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "proof_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ProofKind {
    /// Still image evidence.
    Image,
    /// Video evidence.
    Video,
    /// External link evidence.
    Link,
}

/// `forfeit_state AS ENUM ('pending', 'active', 'unsettled', 'resolved')`.
///
/// This is the persisted lifecycle column for The Bloodline. The transition
/// logic over these states lives in `crate::bloodline`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "forfeit_state", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ForfeitState {
    /// Awaiting opponent accept/decline (or auto-expire).
    Pending,
    /// Accepted; the wager is live through the match.
    Active,
    /// Match decided; loser owes proof of punishment.
    Unsettled,
    /// Archived — completed, declined, expired or defaulted. Terminal.
    Resolved,
}

// ===========================================================================
// Bloodline events
// ===========================================================================

/// Events that can be applied to a forfeit to drive a state transition
/// (CONTRACT §4). Each maps to one API call or a system tick.
///
/// Not persisted directly — it is the *input* to the pure transition function
/// `crate::bloodline::next_state`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForfeitEvent {
    /// `pending → active`: opponent accepts the challenge.
    Accept,
    /// `pending → resolved`: opponent declines the challenge.
    Decline,
    /// `active → unsettled`: the match went final; record the loser.
    Settle {
        /// The user who lost the wager (owes the punishment).
        loser_id: Uuid,
    },
    /// `unsettled → unsettled`: loser submits proof (creates a hall row).
    SubmitProof,
    /// `unsettled → unsettled`: overdue tick increments the nudge counter
    /// (or, at MAX_NUDGES, escalates to resolution — see `next_state`).
    Nudge,
    /// `pending → resolved`: TTL elapsed; the pending challenge is voided.
    Expire,
    /// `unsettled → resolved`: the tribunal reached the net-vote threshold.
    TribunalPass,
}

impl ForfeitEvent {
    /// Stable, lowercase name for an event — used in `AppError::IllegalTransition`
    /// and in logging. Independent of any serde config so error messages are
    /// deterministic.
    pub fn name(&self) -> &'static str {
        match self {
            ForfeitEvent::Accept => "accept",
            ForfeitEvent::Decline => "decline",
            ForfeitEvent::Settle { .. } => "settle",
            ForfeitEvent::SubmitProof => "submit_proof",
            ForfeitEvent::Nudge => "nudge",
            ForfeitEvent::Expire => "expire",
            ForfeitEvent::TribunalPass => "tribunal_pass",
        }
    }
}

impl ForfeitState {
    /// Stable, lowercase name for a state — used in error messages/logging.
    pub fn name(&self) -> &'static str {
        match self {
            ForfeitState::Pending => "pending",
            ForfeitState::Active => "active",
            ForfeitState::Unsettled => "unsettled",
            ForfeitState::Resolved => "resolved",
        }
    }
}

// ===========================================================================
// Table row structs (FromRow mirrors — column names match the DDL exactly)
// ===========================================================================

/// `users` row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    /// Integer Elo rating (seeded at 1500 in the DDL).
    pub elo_rating: i32,
    /// Cumulative fantasy points across the season.
    pub total_points: i32,
    pub created_at: DateTime<Utc>,
}

/// `matches` row. `lock_at` is a GENERATED column (= kickoff_at − 1 minute);
/// we read it but never write it.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Match {
    pub id: Uuid,
    /// Upstream feed id (ingestion idempotency key). Nullable.
    pub ext_ref: Option<String>,
    pub home_team: String,
    pub away_team: String,
    /// e.g. "GROUP F". Nullable.
    pub group_label: Option<String>,
    pub venue: Option<String>,
    pub kickoff_at: DateTime<Utc>,
    /// Generated: predictions lock 60 s before kickoff.
    pub lock_at: DateTime<Utc>,
    pub status: MatchStatus,
    /// SMALLINT in SQL → i16. Nullable until the match is scored.
    pub home_score: Option<i16>,
    pub away_score: Option<i16>,
    pub created_at: DateTime<Utc>,
}

/// `predictions` row (1X2 + optional exact score). UNIQUE(user_id, match_id).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Prediction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub match_id: Uuid,
    pub outcome: Outcome1x2,
    /// SMALLINT → i16. Optional exact-score components.
    pub exact_home: Option<i16>,
    pub exact_away: Option<i16>,
    pub is_locked: bool,
    /// NULL until the match is settled and points are computed.
    pub points_awarded: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `forfeits` row — a Bloodline wager between two friends.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Forfeit {
    pub id: Uuid,
    pub challenger_id: Uuid,
    pub opponent_id: Uuid,
    /// Optional linked match (ON DELETE SET NULL).
    pub match_id: Option<Uuid>,
    /// The punishment on the line (free text).
    pub stake: String,
    pub state: ForfeitState,
    /// Set when the wager settles.
    pub loser_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub unsettled_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    /// SMALLINT → i16. Number of overdue nudges issued so far.
    pub nudge_count: i16,
    pub last_nudge_at: Option<DateTime<Utc>>,
}

/// `hall_of_shame` row — proof ledger entry (one per forfeit).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct HallEntry {
    pub id: Uuid,
    pub forfeit_id: Uuid,
    pub loser_id: Uuid,
    pub proof_url: String,
    pub proof_kind: ProofKind,
    pub caption: Option<String>,
    /// Flips to true when the tribunal passes.
    pub verified: bool,
    pub created_at: DateTime<Utc>,
}

/// `shame_votes` row — a single tribunal thumbs up/down.
/// UNIQUE(entry_id, voter_id); `vote ∈ {-1, +1}`.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ShameVote {
    pub id: Uuid,
    pub entry_id: Uuid,
    pub voter_id: Uuid,
    /// SMALLINT → i16, constrained to -1 or +1 by the DB.
    pub vote: i16,
    pub created_at: DateTime<Utc>,
}
