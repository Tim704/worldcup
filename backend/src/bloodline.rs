//! The Bloodline — the forfeit lifecycle state machine (CONTRACT §4).
//!
// ===========================================================================
// Chain of Thought:
//
// The Bloodline is a four-state lifecycle for a wager between two friends:
//
//     pending → active → unsettled → resolved   (resolved is TERMINAL)
//
// We model it as a *pure guard function* `next_state(current, event)` plus a
// thin DB-applying wrapper `apply_transition`. Keeping the guard pure means the
// entire legality table is unit-testable with zero database, and every handler
// shares one authoritative definition of "what is allowed".
//
// WHY each guard exists
// ---------------------
//  * pending  --accept-->  active
//      The opponent agreed; the wager is now live. We must guard against
//      accepting something that is no longer pending (e.g. already declined or
//      expired) — accepting a resolved forfeit would resurrect a dead wager.
//  * pending  --decline--> resolved
//      The opponent walked away. Terminal; outcome recorded as "declined".
//  * pending  --expire-->  resolved
//      A system tick observed age > PENDING_TTL_SECS. An unaccepted challenge
//      cannot hang around forever, so the TTL voids it. Guarded to `pending`
//      only: an *active* wager is never auto-expired (the match resolves it).
//  * active   --settle-->  unsettled
//      The match went final. We record `loser_id` (the side that owes the
//      punishment) and move to `unsettled`. Only an *active* wager can settle:
//      settling a pending one would skip the acceptance handshake.
//  * unsettled --submit_proof--> unsettled  (SELF-LOOP, idempotent-ish)
//      The loser uploaded evidence. This does NOT advance the state by itself
//      — verification is a separate, community-driven step (the tribunal). The
//      self-loop lets proof be (re)submitted while we await votes.
//  * unsettled --tribunal_pass--> resolved
//      The tribunal reached the net-vote threshold (TRIBUNAL_NET_VOTES). The
//      proof is verified and the forfeit is archived. Guarded to `unsettled`:
//      you cannot "pass the tribunal" on a wager that never reached settlement.
//  * unsettled --nudge--> unsettled       (escalation rungs 1..MAX_NUDGES)
//      A periodic tick fired while proof is overdue (now − unsettled_at beyond
//      PROOF_WINDOW_SECS, then every NUDGE_INTERVAL_SECS). Each nudge bumps
//      `nudge_count` and stamps `last_nudge_at`. This is the escalation LADDER.
//  * unsettled --nudge--> resolved        (top rung: nudge_count ≥ MAX_NUDGES)
//      We have nagged the maximum number of times with no proof. The system
//      gives up waiting and auto-resolves the wager as "defaulted" (an
//      automatic shaming). This is why `next_state` needs the CURRENT
//      nudge_count to decide between the self-loop and the terminal jump —
//      see `next_state_with_nudges` below.
//
// Idempotency / illegal transitions
// ----------------------------------
//  Any (state, event) pair NOT in the table above is rejected with a typed
//  `AppError::IllegalTransition { from, event }` (HTTP 409). In particular,
//  NOTHING transitions out of `resolved` — it is terminal. Re-issuing `accept`
//  on an already-active forfeit is therefore an explicit error rather than a
//  silent no-op, so callers learn their view of the world is stale.
//
// The timeout / nudge escalation ladder (metric SI seconds)
// ---------------------------------------------------------
//  pending lifetime cap:     PENDING_TTL_SECS    = 172800  (48 h)
//  proof grace window:       PROOF_WINDOW_SECS   =  86400  (24 h)
//  inter-nudge spacing:      NUDGE_INTERVAL_SECS =  21600  ( 6 h)
//  max nudges before default: MAX_NUDGES         =      3
//  tribunal net thumbs-up:   TRIBUNAL_NET_VOTES  =      3
//
//  Ladder, once a forfeit enters `unsettled` at t0:
//    t0 .. t0+PROOF_WINDOW_SECS         → grace; no nudges.
//    after grace, every NUDGE_INTERVAL  → nudge (count 1, 2, 3 …).
//    when count reaches MAX_NUDGES       → the next nudge auto-resolves.
//  These constants are surfaced for the (future) scheduler tick; the pure
//  guard itself is time-agnostic and only consumes the resulting `Nudge`
//  events plus the current `nudge_count`.
// ===========================================================================

use chrono::Utc;
use sqlx::postgres::PgPool;
use uuid::Uuid;

use crate::domain::{Forfeit, ForfeitEvent, ForfeitState};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Timeout / nudge constants — metric SI seconds (CONTRACT §4).
// ---------------------------------------------------------------------------

/// Maximum lifetime of a `pending` challenge before auto-expiry: 48 h.
pub const PENDING_TTL_SECS: i64 = 172_800;
/// Grace window after `unsettled` before nudging begins: 24 h.
pub const PROOF_WINDOW_SECS: i64 = 86_400;
/// Spacing between successive nudges once overdue: 6 h.
pub const NUDGE_INTERVAL_SECS: i64 = 21_600;
/// Number of nudges allowed before auto-default resolution.
pub const MAX_NUDGES: i16 = 3;
/// Net thumbs-up votes required for the tribunal to pass.
pub const TRIBUNAL_NET_VOTES: i64 = 3;

// ---------------------------------------------------------------------------
// Pure guard core.
// ---------------------------------------------------------------------------

/// Pure state-transition guard, *time-agnostic* version.
///
/// Implements the FULL transition table from CONTRACT §4, EXCEPT the
/// nudge-count-dependent split (self-loop vs. terminal default), which needs
/// the current `nudge_count`. For the `Nudge` event this function assumes the
/// non-terminal (self-loop) rung; callers that know the live `nudge_count`
/// should use [`next_state_with_nudges`] instead (the DB wrapper does).
///
/// Returns `AppError::IllegalTransition { from, event }` for any pair not in
/// the table. `resolved` is terminal: every event out of it is illegal.
pub fn next_state(
    current: &ForfeitState,
    event: &ForfeitEvent,
) -> Result<ForfeitState, AppError> {
    // Delegate to the nudge-aware variant with a count of 0, which selects the
    // self-loop rung for `Nudge` — the safe, non-terminal default.
    next_state_with_nudges(current, event, 0)
}

/// Pure state-transition guard, with the live `nudge_count` so that the
/// `Nudge` event can choose between the self-loop and the terminal default.
///
/// This is the authoritative table. `next_state` is a thin wrapper.
pub fn next_state_with_nudges(
    current: &ForfeitState,
    event: &ForfeitEvent,
    nudge_count: i16,
) -> Result<ForfeitState, AppError> {
    use ForfeitEvent::*;
    use ForfeitState::*;

    let next = match (current, event) {
        // --- from pending ---------------------------------------------------
        (Pending, Accept) => Active,
        (Pending, Decline) => Resolved,
        (Pending, Expire) => Resolved,

        // --- from active ----------------------------------------------------
        (Active, Settle { .. }) => Unsettled,

        // --- from unsettled -------------------------------------------------
        // Proof submission is a self-loop: stays `unsettled` pending votes.
        (Unsettled, SubmitProof) => Unsettled,
        // Tribunal reaching threshold resolves the forfeit.
        (Unsettled, TribunalPass) => Resolved,
        // Nudge ladder: below MAX_NUDGES it self-loops; AT/above it defaults.
        (Unsettled, Nudge) => {
            if nudge_count >= MAX_NUDGES {
                Resolved
            } else {
                Unsettled
            }
        }

        // --- anything else is illegal (incl. all events out of `resolved`) --
        (from, ev) => {
            return Err(AppError::IllegalTransition {
                from: from.name().to_string(),
                event: ev.name().to_string(),
            });
        }
    };

    Ok(next)
}

// ---------------------------------------------------------------------------
// DB-applying wrapper.
// ---------------------------------------------------------------------------

/// Load a forfeit, compute its next state for `event`, persist the new state
/// plus the relevant lifecycle timestamp / nudge bookkeeping, and return the
/// updated row.
///
/// Inputs are borrowed (no needless clones). The whole read-modify-write runs
/// inside a single transaction so a concurrent transition cannot interleave.
///
/// Side effects per event (mirrors the CONTRACT §4 "side effects" column):
///   * `Accept`        → `accepted_at = now()`
///   * `Decline`       → `resolved_at = now()`
///   * `Expire`        → `resolved_at = now()`
///   * `Settle`        → `unsettled_at = now()`, `loser_id = <event.loser_id>`
///   * `SubmitProof`   → (no forfeit-column change here; the hall row is created
///                        by the caller/route which owns that table write)
///   * `TribunalPass`  → `resolved_at = now()`
///   * `Nudge` (loop)  → `nudge_count += 1`, `last_nudge_at = now()`
///   * `Nudge` (final) → `nudge_count += 1`, `last_nudge_at = now()`,
///                        `resolved_at = now()` (auto-default)
pub async fn apply_transition(
    pool: &PgPool,
    id: Uuid,
    event: &ForfeitEvent,
) -> Result<Forfeit, AppError> {
    // One transaction: SELECT … then UPDATE with the computed target.
    let mut tx = pool.begin().await?;

    // Load the current row (we need its state + nudge_count).
    let current: Forfeit = sqlx::query_as::<_, Forfeit>(
        "SELECT id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at \
         FROM forfeits WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    // Compute the target state using the live nudge_count.
    let target =
        next_state_with_nudges(&current.state, event, current.nudge_count)?;

    // Persist state + the event-specific bookkeeping. We use one UPDATE with
    // COALESCE-friendly explicit columns. The `now()` stamps are set inline.
    let updated: Forfeit = match event {
        ForfeitEvent::Accept => {
            sqlx::query_as::<_, Forfeit>(
                "UPDATE forfeits \
                 SET state = $2, accepted_at = now() \
                 WHERE id = $1 \
                 RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                           created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
            )
            .bind(id)
            .bind(target)
            .fetch_one(&mut *tx)
            .await?
        }

        ForfeitEvent::Decline | ForfeitEvent::Expire => {
            sqlx::query_as::<_, Forfeit>(
                "UPDATE forfeits \
                 SET state = $2, resolved_at = now() \
                 WHERE id = $1 \
                 RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                           created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
            )
            .bind(id)
            .bind(target)
            .fetch_one(&mut *tx)
            .await?
        }

        ForfeitEvent::Settle { loser_id } => {
            sqlx::query_as::<_, Forfeit>(
                "UPDATE forfeits \
                 SET state = $2, unsettled_at = now(), loser_id = $3 \
                 WHERE id = $1 \
                 RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                           created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
            )
            .bind(id)
            .bind(target)
            .bind(*loser_id)
            .fetch_one(&mut *tx)
            .await?
        }

        ForfeitEvent::SubmitProof => {
            // The state itself is unchanged (self-loop); we still write `state`
            // for clarity/idempotency. The hall_of_shame row is inserted by the
            // route handler that owns that table.
            sqlx::query_as::<_, Forfeit>(
                "UPDATE forfeits \
                 SET state = $2 \
                 WHERE id = $1 \
                 RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                           created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
            )
            .bind(id)
            .bind(target)
            .fetch_one(&mut *tx)
            .await?
        }

        ForfeitEvent::TribunalPass => {
            sqlx::query_as::<_, Forfeit>(
                "UPDATE forfeits \
                 SET state = $2, resolved_at = now() \
                 WHERE id = $1 \
                 RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                           created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
            )
            .bind(id)
            .bind(target)
            .fetch_one(&mut *tx)
            .await?
        }

        ForfeitEvent::Nudge => {
            // Always bump the counter and stamp the nudge time. If the target
            // is `resolved` (top rung), also stamp `resolved_at` so the
            // auto-default is timestamped. We branch the SQL on the target.
            if target == ForfeitState::Resolved {
                sqlx::query_as::<_, Forfeit>(
                    "UPDATE forfeits \
                     SET state = $2, nudge_count = nudge_count + 1, last_nudge_at = now(), resolved_at = now() \
                     WHERE id = $1 \
                     RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                               created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
                )
                .bind(id)
                .bind(target)
                .fetch_one(&mut *tx)
                .await?
            } else {
                sqlx::query_as::<_, Forfeit>(
                    "UPDATE forfeits \
                     SET state = $2, nudge_count = nudge_count + 1, last_nudge_at = now() \
                     WHERE id = $1 \
                     RETURNING id, challenger_id, opponent_id, match_id, stake, state, loser_id, \
                               created_at, accepted_at, unsettled_at, resolved_at, nudge_count, last_nudge_at",
                )
                .bind(id)
                .bind(target)
                .fetch_one(&mut *tx)
                .await?
            }
        }
    };

    tx.commit().await?;

    // Touch `Utc` so the import is always used even if the DB sets times; this
    // keeps a single, explicit dependency surface for the time crate. (Stamps
    // above are computed by Postgres `now()`; we log the wall-clock here.)
    tracing::debug!(
        forfeit.id = %updated.id,
        forfeit.state = updated.state.name(),
        at = %Utc::now(),
        "applied bloodline transition"
    );

    Ok(updated)
}

// ---------------------------------------------------------------------------
// Tests — legal and illegal transitions over the pure guard.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ForfeitState::*;

    fn settle() -> ForfeitEvent {
        ForfeitEvent::Settle {
            loser_id: Uuid::nil(),
        }
    }

    #[test]
    fn pending_accept_goes_active() {
        assert_eq!(next_state(&Pending, &ForfeitEvent::Accept).unwrap(), Active);
    }

    #[test]
    fn pending_decline_resolves() {
        assert_eq!(
            next_state(&Pending, &ForfeitEvent::Decline).unwrap(),
            Resolved
        );
    }

    #[test]
    fn pending_expire_resolves() {
        assert_eq!(
            next_state(&Pending, &ForfeitEvent::Expire).unwrap(),
            Resolved
        );
    }

    #[test]
    fn active_settle_goes_unsettled() {
        assert_eq!(next_state(&Active, &settle()).unwrap(), Unsettled);
    }

    #[test]
    fn unsettled_submit_proof_self_loops() {
        assert_eq!(
            next_state(&Unsettled, &ForfeitEvent::SubmitProof).unwrap(),
            Unsettled
        );
    }

    #[test]
    fn unsettled_tribunal_pass_resolves() {
        assert_eq!(
            next_state(&Unsettled, &ForfeitEvent::TribunalPass).unwrap(),
            Resolved
        );
    }

    #[test]
    fn nudge_below_max_self_loops() {
        // count 0 → still unsettled.
        assert_eq!(
            next_state_with_nudges(&Unsettled, &ForfeitEvent::Nudge, 0).unwrap(),
            Unsettled
        );
        // count MAX-1 (=2) → still unsettled.
        assert_eq!(
            next_state_with_nudges(&Unsettled, &ForfeitEvent::Nudge, MAX_NUDGES - 1)
                .unwrap(),
            Unsettled
        );
    }

    #[test]
    fn nudge_at_max_defaults_to_resolved() {
        assert_eq!(
            next_state_with_nudges(&Unsettled, &ForfeitEvent::Nudge, MAX_NUDGES).unwrap(),
            Resolved
        );
    }

    // --- illegal transitions ------------------------------------------------

    #[test]
    fn accepting_active_is_illegal() {
        let err = next_state(&Active, &ForfeitEvent::Accept).unwrap_err();
        match err {
            AppError::IllegalTransition { from, event } => {
                assert_eq!(from, "active");
                assert_eq!(event, "accept");
            }
            other => panic!("expected IllegalTransition, got {other:?}"),
        }
    }

    #[test]
    fn settling_pending_is_illegal() {
        assert!(matches!(
            next_state(&Pending, &settle()),
            Err(AppError::IllegalTransition { .. })
        ));
    }

    #[test]
    fn resolved_is_terminal() {
        // No event escapes resolved.
        for ev in [
            ForfeitEvent::Accept,
            ForfeitEvent::Decline,
            ForfeitEvent::Expire,
            settle(),
            ForfeitEvent::SubmitProof,
            ForfeitEvent::Nudge,
            ForfeitEvent::TribunalPass,
        ] {
            assert!(matches!(
                next_state(&Resolved, &ev),
                Err(AppError::IllegalTransition { .. })
            ));
        }
    }
}
