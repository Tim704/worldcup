/**
 * MainEventCard.tsx
 * ----------------------------------------------------------------------------
 * The featured "Main Event" presentation (CONTRACT §7.1/§7.4): a gold kicker
 * over a hero-treated MatchCard — warmer --hero paper, bigger Fraunces type,
 * the same 1.5px ink border and 6px hard shadow. Used in the Hub's hero rail
 * and inline in the day-grouped feed for any match with is_featured = true.
 *
 * All prediction behaviour (steppers, lock, points badges, revealed calls)
 * is inherited from MatchCard so the two presentations can never drift.
 * ----------------------------------------------------------------------------
 */

import type { MatchWithMine, Prediction } from '../types/models';
import MatchCard from './MatchCard';

interface MainEventCardProps {
  match: MatchWithMine;
  /** Bubbled after a successful prediction save. */
  onSaved?: (prediction: Prediction) => void;
}

export default function MainEventCard({ match, onSaved }: MainEventCardProps): JSX.Element {
  return (
    <div className="mainevent">
      <span className="kicker">main event</span>
      <MatchCard match={match} hero onSaved={onSaved} />
    </div>
  );
}
