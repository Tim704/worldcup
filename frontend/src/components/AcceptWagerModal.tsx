/**
 * AcceptWagerModal.tsx
 * ----------------------------------------------------------------------------
 * Taking the other side of a public boast (CONTRACT §7.4): the modal shows the
 * claim and its match, REQUIRES the acceptor to type a forfeit (3–140 chars,
 * mirroring the DB CHECK), and confirms with the canned "seal it" button.
 * The loser — whoever that turns out to be — owes the forfeit.
 *
 * POST /api/wagers/:id/accept {forfeit}; server-side guards (locked match,
 * own wager, already accepted) surface here via the ApiError envelope.
 * ----------------------------------------------------------------------------
 */

import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatKickoff } from '../lib/datetime';
import type { WagerView } from '../types/models';
import Modal from './Modal';
import { describePick } from './WagerCard';

/** Forfeit text bounds, mirroring the wagers.forfeit CHECK (3–140 chars). */
const FORFEIT_MIN = 3;
const FORFEIT_MAX = 140;

interface AcceptWagerModalProps {
  wager: WagerView;
  onClose: () => void;
  /** Called with the freshly ACCEPTED wager so the parent can refresh. */
  onAccepted: (wager: WagerView) => void;
}

export default function AcceptWagerModal({
  wager,
  onClose,
  onAccepted,
}: AcceptWagerModalProps): JSX.Element {
  const [forfeit, setForfeit] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = forfeit.trim();
  const valid = trimmed.length >= FORFEIT_MIN && trimmed.length <= FORFEIT_MAX;

  async function seal(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const accepted = await api.acceptWager(wager.id, trimmed);
      onAccepted(accepted);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'the wire is down. try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title="take the other side" onClose={onClose}>
      <div className="stack">
        <p className="wager-claim">&ldquo;{wager.claim}&rdquo;</p>
        <p className="hint">
          {wager.home_team} vs {wager.away_team} · {formatKickoff(wager.kickoff_at)}
        </p>
        <p className="hint">
          @{wager.creator_username} calls {describePick(wager)}. accepting means you say otherwise.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="accept-forfeit">
            name the forfeit. the loser owes it, no appeals.
          </label>
          <textarea
            id="accept-forfeit"
            className="input"
            rows={2}
            maxLength={FORFEIT_MAX}
            value={forfeit}
            onChange={(e) => setForfeit(e.target.value)}
            placeholder="loser sings the winner's anthem, in public, full volume"
          />
          <span className="hint">
            {trimmed.length}/{FORFEIT_MAX} — at least {FORFEIT_MIN} characters.
          </span>
        </div>

        {err && <p className="form-error">{err}</p>}

        <button type="button" className="btn" onClick={() => void seal()} disabled={!valid || busy}>
          {busy ? 'sealing…' : 'seal it'}
        </button>
      </div>
    </Modal>
  );
}
