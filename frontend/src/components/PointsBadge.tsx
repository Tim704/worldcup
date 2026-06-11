/**
 * PointsBadge.tsx
 * ----------------------------------------------------------------------------
 * The 5/2/0 outcome badge (CONTRACT §4/§7.4): `+5 exact` / `+2 outcome` / `0`.
 * Renders nothing until a prediction is settled (points === null). Shared by
 * MatchCard (my own call) and TableCalls (each revealed row) so the two can
 * never drift.
 * ----------------------------------------------------------------------------
 */

interface PointsBadgeProps {
  /** points_awarded: 5 (exact) / 2 (outcome) / 0, or null until settlement. */
  points: number | null;
}

export default function PointsBadge({ points }: PointsBadgeProps): JSX.Element | null {
  if (points === null) return null;
  if (points === 5) return <span className="points-badge points-badge--exact">+5 exact</span>;
  if (points === 2) return <span className="points-badge points-badge--outcome">+2 outcome</span>;
  return <span className="points-badge points-badge--zero">0</span>;
}
