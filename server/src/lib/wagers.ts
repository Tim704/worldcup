/**
 * wagers.ts — pure wager resolution (Contract §5).
 *
 * A wager is a machine-evaluable public boast: a `pick` (home/draw/away)
 * plus an optional `margin` ("wins by ≥ N goals", non-draw picks only).
 * This module decides, given the final score, whether the CREATOR won.
 * It is pure and unit-tested; the admin settlement pipeline persists its
 * verdicts in one batch UPDATE.
 */
import type { WagerPick } from '../types.js';

/** The verdict for one accepted wager, from the creator's perspective. */
export interface WagerResolution {
  /** true → creator's boast held; false → the acceptor takes it. */
  creator_wins: boolean;
  /** The terminal wager_state to persist (creator's perspective). */
  state: 'RESOLVED_WON' | 'RESOLVED_LOST';
}

const PICKS: readonly WagerPick[] = ['home', 'draw', 'away'];

// Chain of Thought:
// 1. Inputs come from the DB at settlement time, but settlement may re-run
//    with CORRECTED scores (idempotent pipeline, Contract §4.5), so we cannot
//    assume anything was pre-checked: re-validate everything and throw on
//    nonsense rather than fabricate a verdict.
// 2. Goals are counts → actualHome/actualAway must each be non-negative safe
//    integers. Negative, fractional, NaN or Infinite scores cannot describe
//    a football result → RangeError guard.
// 3. `pick` must be one of the three enum values 'home' | 'draw' | 'away'.
//    The DB enum guarantees this for stored rows, but this function is also
//    callable directly — guard it so a bad cast can never resolve a wager.
// 4. `margin` semantics: "wins by ≥ N goals". A draw has no winner, so a
//    margin on a 'draw' pick is meaningless — the DB CHECK
//    (wagers_margin_needs_side) forbids it and so do we. Range: the DB CHECK
//    allows 1..10; a margin of 0 would be vacuous ("wins by ≥ 0") and
//    anything beyond 10 is outside the agreed product rules → RangeError.
//    `margin` may be null/undefined → plain pick, no distance requirement.
// 5. Let d = actualHome - actualAway (the signed final goal difference).
//    The actual outcome is fully determined by the sign of d:
//        d > 0 → 'home' won;  d < 0 → 'away' won;  d = 0 → 'draw'.
// 6. The creator's boast holds iff BOTH conditions hold:
//      (a) pick === actual            — they called the right outcome, and
//      (b) margin == null || |d| >= margin — if they promised a distance,
//          the winning distance must reach it. |d| is the winning margin
//          regardless of side; the boundary case |d| === margin COUNTS as
//          met ("by ≥ N goals" is inclusive). Note (a) already rules out the
//          wrong-side case: a 0–3 result never satisfies a 'home' pick even
//          though |d| = 3 ≥ margin — the conjunction makes that explicit.
// 7. creator wins → RESOLVED_WON (winner = creator, loser = acceptor);
//    otherwise → RESOLVED_LOST with the ids swapped. The caller assigns the
//    ids; this function only renders the verdict. The loser owes the forfeit.
/**
 * Resolve an accepted wager against the final score.
 *
 * @param pick       the creator's pick: 'home' | 'draw' | 'away'
 * @param margin     optional "wins by ≥ margin goals" (1–10, non-draw only)
 * @param actualHome final home goals (a_h)
 * @param actualAway final away goals (a_a)
 * @returns the creator-perspective verdict to persist
 */
export function resolveWager(
  pick: WagerPick,
  margin: number | null | undefined,
  actualHome: number,
  actualAway: number,
): WagerResolution {
  // Guard 2 — scores are non-negative safe integers.
  for (const [name, value] of [
    ['actualHome', actualHome],
    ['actualAway', actualAway],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`resolveWager: ${name} must be a non-negative integer, got ${value}`);
    }
  }

  // Guard 3 — pick is a real enum member.
  if (!PICKS.includes(pick)) {
    throw new RangeError(`resolveWager: pick must be one of ${PICKS.join('/')}, got ${String(pick)}`);
  }

  // Guard 4 — margin: null/undefined, or an integer 1..10 on a non-draw pick.
  if (margin !== null && margin !== undefined) {
    if (!Number.isSafeInteger(margin) || margin < 1 || margin > 10) {
      throw new RangeError(`resolveWager: margin must be an integer between 1 and 10, got ${margin}`);
    }
    if (pick === 'draw') {
      throw new RangeError('resolveWager: margin is not allowed on a draw pick');
    }
  }

  // Step 5 — derive the actual outcome from the signed goal difference d.
  const d = actualHome - actualAway;
  const actual: WagerPick = d > 0 ? 'home' : d < 0 ? 'away' : 'draw';

  // Step 6 — the boast holds iff the outcome matches AND any promised margin
  // is reached (inclusive boundary: |d| >= margin).
  const creatorWins =
    pick === actual && (margin === null || margin === undefined || Math.abs(d) >= margin);

  // Step 7 — render the verdict from the creator's perspective.
  return {
    creator_wins: creatorWins,
    state: creatorWins ? 'RESOLVED_WON' : 'RESOLVED_LOST',
  };
}
