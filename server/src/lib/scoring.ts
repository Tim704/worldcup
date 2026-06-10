/**
 * scoring.ts — the 5/2/0 scoring algorithm (Contract §4).
 *
 * This pure function is the SOURCE OF TRUTH for points. The admin settlement
 * pipeline computes points here in TypeScript and only uses SQL to persist
 * the results — never to derive them.
 */

/** The only three values a settled prediction can be worth. */
export type PointsAwarded = 0 | 2 | 5;

/**
 * Score one prediction (p_h, p_a) against the final score (a_h, a_a).
 *
 * Piecewise formula (LaTeX, repo tradition):
 *
 *   P =
 *   \begin{cases}
 *     5 & \text{if } p_h = a_h \wedge p_a = a_a              & (\text{exact score}) \\
 *     2 & \text{if } \operatorname{sgn}(p_h - p_a) = \operatorname{sgn}(a_h - a_a) & (\text{correct outcome}) \\
 *     0 & \text{otherwise}
 *   \end{cases}
 *
 * Tiers are exclusive and checked top-down: an exact score is worth exactly
 * 5, never 5 + 2. `sgn` equality means: home-win predicted & home won
 * (both diffs > 0), draw predicted & drawn (both diffs = 0), or away-win
 * predicted & away won (both diffs < 0). A user's season total is
 * \sum P over all final matches (recomputed in one statement at settlement).
 *
 * Guards: goals are counts — every argument must be a non-negative safe
 * integer. Anything else (negative, fractional, NaN, Infinity) is a caller
 * bug and throws a RangeError rather than silently mis-scoring.
 *
 * @param predHome   predicted home goals (p_h)
 * @param predAway   predicted away goals (p_a)
 * @param actualHome final home goals     (a_h)
 * @param actualAway final away goals     (a_a)
 * @returns 5 (exact) | 2 (outcome) | 0 (miss)
 */
export function scorePrediction(
  predHome: number,
  predAway: number,
  actualHome: number,
  actualAway: number,
): PointsAwarded {
  for (const [name, value] of [
    ['predHome', predHome],
    ['predAway', predAway],
    ['actualHome', actualHome],
    ['actualAway', actualAway],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`scorePrediction: ${name} must be a non-negative integer, got ${value}`);
    }
  }

  // Tier 1 — exact score: both goal counts match. Worth 5.
  if (predHome === actualHome && predAway === actualAway) return 5;

  // Tier 2 — correct outcome: the sign of the predicted goal difference
  // equals the sign of the actual goal difference (home win / draw / away
  // win all agree). Worth 2. Math.sign maps to {-1, 0, 1} for our integer
  // diffs, exactly the sgn of the formula.
  if (Math.sign(predHome - predAway) === Math.sign(actualHome - actualAway)) return 2;

  // Tier 3 — everything else. Worth 0.
  return 0;
}
