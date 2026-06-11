/**
 * BracketMatchup.tsx
 * ----------------------------------------------------------------------------
 * One knockout tie (Contract §11): a small paper panel with the FIFA match
 * number and two TeamRows. Tapping a decided side advances that team — the
 * view writes the pick and the bracket engine cascades it; tapping the picked
 * side again takes it back. Undecided sides render their placeholder label
 * ("group a winner", "best 3rd · c/e/f/h/i", "winner of m89") and cannot be
 * picked.
 * ----------------------------------------------------------------------------
 */

import TeamRow from './TeamRow';
import type { ResolvedSlot } from '../lib/bracket';

interface BracketMatchupProps {
  slot: ResolvedSlot;
  /** Advance `team` in this slot (the view un-picks on a repeat tap). */
  onPick: (team: string) => void;
  /** Browsing another player's tree — show the pick, take no taps. */
  readOnly?: boolean;
}

export default function BracketMatchup({
  slot,
  onPick,
  readOnly = false,
}: BracketMatchupProps): JSX.Element {
  // A decided tie that has a winner picked: the OTHER side is eliminated —
  // mute it so the survivor reads at a glance.
  const decided = slot.pick !== null;
  return (
    <article
      className={`bracket-match${decided ? ' bracket-match--decided' : ''}`}
      aria-label={`knockout tie ${slot.key}`}
    >
      <span className="hint tnum">{slot.key.toLowerCase()}</span>
      {[slot.home, slot.away].map((side, i) => {
        const isPick = side.team !== null && slot.pick === side.team;
        const eliminated = decided && side.team !== null && !isPick;
        return (
          <TeamRow
            // Sides are positional (home/away of a fixed slot) — index is stable.
            // eslint-disable-next-line react/no-array-index-key
            key={`${slot.key}-${i}`}
            team={side.team}
            placeholder={side.label}
            selected={isPick}
            muted={eliminated}
            onClick={!readOnly && side.team !== null ? () => onPick(side.team as string) : undefined}
            ariaLabel={
              readOnly
                ? side.team !== null
                  ? isPick
                    ? `${side.team} advances from ${slot.key}`
                    : `${side.team}, did not advance from ${slot.key}`
                  : undefined
                : side.team !== null
                  ? isPick
                    ? `${side.team} advances from ${slot.key} — tap to take it back`
                    : `advance ${side.team} from ${slot.key}`
                  : undefined
            }
          />
        );
      })}
    </article>
  );
}
