/**
 * WagerCard.tsx
 * ----------------------------------------------------------------------------
 * One public boast as a paper object (CONTRACT §7.4 "Wagers"):
 *   - jewel StateChip: PENDING gold · ACCEPTED teal · RESOLVED_WON forest ·
 *     RESOLVED_LOST coral · "expired, unclaimed" when a PENDING wager's match
 *     locked without an acceptor;
 *   - the claim in Fraunces, the machine-evaluable pick spelled out beneath;
 *   - ACCEPTED cards show who took it and what is at stake;
 *   - settled cards read the ledger line: "@loser owes @winner: <forfeit>";
 *   - accept button (market, not my own wager, still unlocked) and withdraw
 *     button (my own wager, still PENDING) are driven by the optional
 *     callbacks — parents decide which actions exist in which tab.
 * ----------------------------------------------------------------------------
 */

import { formatKickoff, isLocked } from '../lib/datetime';
import type { WagerView } from '../types/models';
import StateChip from './StateChip';
import type { ChipKind } from './StateChip';

/**
 * Spell out the machine-evaluable pick as lowercase copy:
 *   home/away without margin → "Brazil to win"
 *   home/away with margin    → "Brazil by 2+ goals"
 *   draw                     → "a draw"
 * Shared with AcceptWagerModal so both surfaces describe the bet identically.
 */
export function describePick(w: WagerView): string {
  if (w.pick === 'draw') return 'a draw';
  const side = w.pick === 'home' ? w.home_team : w.away_team;
  return w.margin !== null ? `${side} by ${w.margin}+ goals` : `${side} to win`;
}

interface WagerCardProps {
  wager: WagerView;
  /** The signed-in user's id, to tell my boasts from the table's. */
  meId: string;
  /** Offered in the market: opens the AcceptWagerModal. */
  onAccept?: (wager: WagerView) => void;
  /** Offered to the creator while PENDING: deletes the wager. */
  onWithdraw?: (wager: WagerView) => void;
}

export default function WagerCard({ wager: w, meId, onAccept, onWithdraw }: WagerCardProps): JSX.Element {
  const now = new Date();
  const locked = isLocked(w, now);

  // A PENDING wager whose match locked without an acceptor is dead stock:
  // still PENDING in the DB, but shown as "expired, unclaimed" (CONTRACT §5).
  const expired = w.state === 'PENDING' && locked;
  const chipKind: ChipKind = expired ? 'expired' : w.state;

  const settled = w.state === 'RESOLVED_WON' || w.state === 'RESOLVED_LOST';
  const isMine = w.creator_id === meId;
  const canAccept = onAccept !== undefined && w.state === 'PENDING' && !locked && !isMine;
  const canWithdraw = onWithdraw !== undefined && w.state === 'PENDING' && isMine;
  const finalScore =
    w.match_status === 'final' && w.home_score !== null && w.away_score !== null
      ? `final: ${w.home_score} – ${w.away_score}`
      : null;

  return (
    <article className="card wager-card">
      <div className="wager-head">
        <StateChip kind={chipKind} />
        <span className="hint">
          {w.home_team} vs {w.away_team} · {finalScore ?? formatKickoff(w.kickoff_at, now)}
        </span>
      </div>

      <p className="wager-claim">&ldquo;{w.claim}&rdquo;</p>
      <p className="hint">
        @{w.creator_username} calls {describePick(w)}.
      </p>

      {/* Who took the other side, and what the loser will owe. */}
      {w.state === 'ACCEPTED' && w.acceptor_username && w.forfeit && (
        <p className="hint">
          @{w.acceptor_username} took it. on the line: {w.forfeit}
        </p>
      )}

      {/* The settled ledger line. */}
      {settled && w.winner_username && w.loser_username && w.forfeit && (
        <p className="ledger-line">
          @{w.loser_username} owes @{w.winner_username}:{' '}
          <span className="ledger-forfeit">{w.forfeit}</span>
        </p>
      )}

      {(canAccept || canWithdraw) && (
        <div className="wager-actions">
          {canAccept && (
            <button type="button" className="btn btn--small" onClick={() => onAccept?.(w)}>
              take the other side
            </button>
          )}
          {canWithdraw && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => onWithdraw?.(w)}
            >
              withdraw
            </button>
          )}
        </div>
      )}
    </article>
  );
}
