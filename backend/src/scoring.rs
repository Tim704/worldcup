//! Scoring algorithm — pure functions (CONTRACT §5).
//!
//! Every public function here is a *pure* function: it borrows its inputs and
//! returns a number with no I/O and no mutation. This keeps the math trivially
//! unit-testable and reusable from any handler. The LaTeX documenting each
//! formula is reproduced verbatim from CONTRACT §5.

// ---------------------------------------------------------------------------
// Tuning constants (fixed by the contract).
// ---------------------------------------------------------------------------

/// Contrarian multiplier weight $\alpha = 0.5$.
const ALPHA: f64 = 0.5;

/// Elo K-factor $K = 24$.
const ELO_K: f64 = 24.0;

// ---------------------------------------------------------------------------
// (a) Per-match fantasy base points.
// ---------------------------------------------------------------------------

/// Per-match fantasy base points for a prediction vs the actual scoreline.
///
/// For prediction $(p_h, p_a)$ vs actual $(a_h, a_a)$, with indicator
/// $[\,\cdot\,]$:
///
/// $$
/// P_{\text{base}} =
/// \begin{cases}
/// 5 & \text{if } [p_h = a_h \wedge p_a = a_a] \quad(\text{exact score})\\
/// 3 & \text{if } [(p_h - p_a) = (a_h - a_a)] \quad(\text{correct goal difference})\\
/// 2 & \text{if } [\operatorname{sgn}(p_h - p_a) = \operatorname{sgn}(a_h - a_a)] \quad(\text{correct result})\\
/// 0 & \text{otherwise}
/// \end{cases}
/// $$
///
/// Tiers are **exclusive** and checked **top-down**: the first matching tier
/// wins. Scores are `i16` (SMALLINT in SQL); differences are widened to `i32`
/// to avoid any overflow.
pub fn fantasy_base_points(pred: &(i16, i16), actual: &(i16, i16)) -> i32 {
    let (ph, pa) = (pred.0 as i32, pred.1 as i32);
    let (ah, aa) = (actual.0 as i32, actual.1 as i32);

    // Tier 1 — exact score: both components equal.
    if ph == ah && pa == aa {
        return 5;
    }
    // Tier 2 — correct goal difference: (p_h - p_a) == (a_h - a_a).
    if (ph - pa) == (ah - aa) {
        return 3;
    }
    // Tier 3 — correct result (1X2): same sign of the goal difference.
    if (ph - pa).signum() == (ah - aa).signum() {
        return 2;
    }
    // Otherwise — nothing.
    0
}

// ---------------------------------------------------------------------------
// (b) Contrarian multiplier & total points.
// ---------------------------------------------------------------------------

/// Contrarian multiplier rewarding against-the-grain calls.
///
/// With crowd probability $p_o \in (0,1]$ of the predicted outcome and
/// $\alpha = 0.5$:
///
/// $$ m = 1 + \alpha\,(1 - p_o). $$
///
/// A consensus pick ($p_o = 1$) yields $m = 1$ (no bonus); a long-shot pick
/// ($p_o \to 0$) approaches $m = 1.5$. `crowd_p` is clamped to $(0,1]$ for
/// safety against bad upstream data.
pub fn contrarian_multiplier(crowd_p: f64) -> f64 {
    // Clamp into the valid open-lower/closed-upper interval (0, 1].
    // A tiny epsilon keeps the lower bound strictly positive.
    let p = crowd_p.clamp(f64::EPSILON, 1.0);
    1.0 + ALPHA * (1.0 - p)
}

/// Total per-match points after applying the contrarian multiplier.
///
/// $$ P_{\text{total}} = \big\lceil P_{\text{base}} \cdot m \big\rceil . $$
///
/// The ceiling means any fractional bonus rounds **up** in the player's favour.
pub fn total_points(base: i32, crowd_p: f64) -> i32 {
    let m = contrarian_multiplier(crowd_p);
    (base as f64 * m).ceil() as i32
}

// ---------------------------------------------------------------------------
// (c) Elo expectation & update.
// ---------------------------------------------------------------------------

/// Elo expected score for player A against player B.
///
/// $$ E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}}. $$
///
/// Returns a probability in $(0, 1)$.
pub fn elo_expected(r_a: f64, r_b: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf((r_b - r_a) / 400.0))
}

/// Elo rating update for player A.
///
/// $$ R_A' = R_A + K\,(S_A - E_A), \qquad K = 24, $$
///
/// where $S_A \in \{1, 0.5, 0\}$ is the realized result (win/draw/loss) for
/// player A and $E_A$ is the expected score from [`elo_expected`].
pub fn elo_update(r_a: f64, score: f64, expected: f64) -> f64 {
    r_a + ELO_K * (score - expected)
}

// ---------------------------------------------------------------------------
// Tests — assert the known reference values called out in the contract.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_points_exact_score_is_5() {
        // Predicted 2-1, actual 2-1 → exact score tier.
        assert_eq!(fantasy_base_points(&(2, 1), &(2, 1)), 5);
    }

    #[test]
    fn base_points_goal_difference_is_3() {
        // Predicted 2-1 (diff +1), actual 3-2 (diff +1), not exact → 3.
        assert_eq!(fantasy_base_points(&(2, 1), &(3, 2)), 3);
    }

    #[test]
    fn base_points_correct_result_is_2() {
        // Predicted 1-0 (home win), actual 3-1 (home win), diff differs → 2.
        assert_eq!(fantasy_base_points(&(1, 0), &(3, 1)), 2);
    }

    #[test]
    fn base_points_wrong_is_0() {
        // Predicted home win, actual away win → 0.
        assert_eq!(fantasy_base_points(&(2, 0), &(0, 2)), 0);
    }

    #[test]
    fn base_points_draw_goal_difference_collapses_to_result() {
        // Predicted 1-1 (diff 0), actual 2-2 (diff 0) → goal-difference tier (3).
        assert_eq!(fantasy_base_points(&(1, 1), &(2, 2)), 3);
    }

    #[test]
    fn contrarian_consensus_is_unity() {
        // Crowd certainty p_o = 1 → multiplier exactly 1.0.
        assert!((contrarian_multiplier(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn contrarian_longshot_approaches_1_5() {
        // p_o → 0 → multiplier → 1.5.
        assert!((contrarian_multiplier(f64::EPSILON) - 1.5).abs() < 1e-9);
    }

    #[test]
    fn total_points_ceils_the_bonus() {
        // base 3, crowd_p 0.5 → m = 1 + 0.5*0.5 = 1.25 → 3*1.25 = 3.75 → ceil 4.
        assert_eq!(total_points(3, 0.5), 4);
        // base 5, crowd_p 0.2 → m = 1 + 0.5*0.8 = 1.4 → 5*1.4 = 7.0 → 7.
        assert_eq!(total_points(5, 0.2), 7);
        // base 0 → always 0 regardless of multiplier.
        assert_eq!(total_points(0, 0.1), 0);
    }

    #[test]
    fn elo_expected_equal_ratings_is_half() {
        // Equal ratings → 0.5 expected.
        assert!((elo_expected(1500.0, 1500.0) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn elo_update_win_against_equal_gains_half_k() {
        // Equal ratings, A wins (S=1, E=0.5) → +K/2 = +12.
        let e = elo_expected(1500.0, 1500.0);
        let r = elo_update(1500.0, 1.0, e);
        assert!((r - 1512.0).abs() < 1e-9);
    }

    #[test]
    fn elo_update_loss_against_equal_loses_half_k() {
        // Equal ratings, A loses (S=0, E=0.5) → -K/2 = -12.
        let e = elo_expected(1500.0, 1500.0);
        let r = elo_update(1500.0, 0.0, e);
        assert!((r - 1488.0).abs() < 1e-9);
    }
}
