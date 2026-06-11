/**
 * GroupCard.tsx
 * ----------------------------------------------------------------------------
 * One group (A–L) as a tap-to-rank paper card (Contract §11):
 *   - tap an unplaced team → it takes the next finishing position;
 *   - tap a placed team → that position and everything below it clears
 *     (an order is an order — you cannot pull out the middle);
 *   - once all but one team is placed, the last one auto-fills.
 *
 * Positions 1–2 advance outright (gold dot + "through" pill); position 3 is
 * berth-eligible — the separate best-thirds card decides whether it shows
 * "wildcard" (teal) or a quiet "3rd"; position 4 is "out". State lives in the
 * view (single source); this card is a pure (props → taps) component.
 * ----------------------------------------------------------------------------
 */

import TeamRow, { type TeamRowChip } from './TeamRow';
import type { GroupTeams } from '../lib/bracket';

interface GroupCardProps {
  group: GroupTeams;
  /** Ranked-so-far team names; index 0 = predicted group winner. */
  order: string[];
  /** Is this group's letter among the user's best-third picks? */
  thirdAdvances: boolean;
  onChange: (order: string[]) => void;
  /** Browsing another player's prophecy — render the ranking, take no taps. */
  readOnly?: boolean;
}

/** The status pill for a placed team, by finishing position. */
function chipFor(rank: number | null, thirdAdvances: boolean): TeamRowChip | null {
  if (rank === null) return null;
  if (rank <= 2) return { tone: 'gold', label: 'through' };
  if (rank === 3) {
    return thirdAdvances ? { tone: 'teal', label: 'wildcard' } : { tone: 'quiet', label: '3rd' };
  }
  return { tone: 'quiet', label: 'out' };
}

export default function GroupCard({
  group,
  order,
  thirdAdvances,
  onChange,
  readOnly = false,
}: GroupCardProps): JSX.Element {
  const complete = group.teams.length > 0 && order.length === group.teams.length;

  function tap(team: string): void {
    const at = order.indexOf(team);
    if (at >= 0) {
      // Clear this position and everything ranked after it.
      onChange(order.slice(0, at));
      return;
    }
    const next = [...order, team];
    // All but one placed → the last team's position is forced; fill it in.
    if (next.length === group.teams.length - 1) {
      const last = group.teams.find((t) => !next.includes(t));
      if (last) next.push(last);
    }
    onChange(next);
  }

  return (
    <section className="card group-card" aria-label={`group ${group.letter}`}>
      <div className="group-head">
        <span className="kicker">group {group.letter.toLowerCase()}</span>
        {!readOnly && order.length > 0 && (
          <button type="button" className="chip chip--small" onClick={() => onChange([])}>
            reset
          </button>
        )}
      </div>

      {group.teams.map((team) => {
        const at = order.indexOf(team);
        const rank = at >= 0 ? at + 1 : null;
        return (
          <TeamRow
            key={team}
            team={team}
            rank={rank}
            chip={chipFor(rank, thirdAdvances)}
            onClick={readOnly ? undefined : () => tap(team)}
            ariaLabel={
              readOnly
                ? rank !== null
                  ? `${team}, placed ${rank} in group ${group.letter}`
                  : `${team}, unplaced in group ${group.letter}`
                : rank !== null
                  ? `${team}, placed ${rank} in group ${group.letter} — tap to clear`
                  : `${team} — tap to place next in group ${group.letter}`
            }
          />
        );
      })}

      {!readOnly && !complete && <p className="hint">tap teams in finishing order.</p>}
    </section>
  );
}
