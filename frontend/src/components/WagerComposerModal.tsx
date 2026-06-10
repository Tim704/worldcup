/**
 * WagerComposerModal.tsx
 * ----------------------------------------------------------------------------
 * Composing a public boast (CONTRACT §7.4): pick an unlocked match, choose a
 * side via chips (home / draw / away), optionally arm a winning-margin stepper
 * ("by 2+ goals", 1–10, non-draw picks only — mirrors the DB CHECK
 * wagers_margin_needs_side), and write the human claim (3–140 chars).
 *
 * POST /api/wagers {match_id, pick, margin?, claim} → the parent receives the
 * fresh PENDING WagerView via onCreated.
 * ----------------------------------------------------------------------------
 */

import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatKickoff } from '../lib/datetime';
import type { MatchWithMine, WagerPick, WagerView } from '../types/models';
import Modal from './Modal';
import ScoreStepper from './ScoreStepper';

/** Claim text bounds, mirroring the wagers.claim CHECK (3–140 chars). */
const CLAIM_MIN = 3;
const CLAIM_MAX = 140;

interface WagerComposerModalProps {
  /** Unlocked matches only (now < lock_at), kickoff ASC — parent pre-filters. */
  matches: MatchWithMine[];
  onClose: () => void;
  /** Called with the freshly created PENDING wager so the parent can refresh. */
  onCreated: (wager: WagerView) => void;
}

export default function WagerComposerModal({
  matches,
  onClose,
  onCreated,
}: WagerComposerModalProps): JSX.Element {
  const [matchId, setMatchId] = useState<string>(matches[0]?.id ?? '');
  const [pick, setPick] = useState<WagerPick>('home');
  const [withMargin, setWithMargin] = useState<boolean>(false);
  const [margin, setMargin] = useState<number>(2);
  const [claim, setClaim] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = matches.find((m) => m.id === matchId) ?? null;
  const trimmedClaim = claim.trim();
  const claimValid = trimmedClaim.length >= CLAIM_MIN && trimmedClaim.length <= CLAIM_MAX;
  const canSubmit = selected !== null && claimValid && !busy;

  /** Choose a side; the draw cannot carry a margin, so picking it disarms one. */
  function choosePick(next: WagerPick): void {
    setPick(next);
    if (next === 'draw') setWithMargin(false);
  }

  async function create(): Promise<void> {
    if (!canSubmit || selected === null) return;
    setBusy(true);
    setErr(null);
    try {
      const wager = await api.createWager({
        match_id: selected.id,
        pick,
        // margin only ships when armed AND the pick has a side (never draw).
        margin: withMargin && pick !== 'draw' ? margin : undefined,
        claim: trimmedClaim,
      });
      onCreated(wager);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'the wire is down. try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title="say something confident" onClose={onClose}>
      {matches.length === 0 ? (
        <p className="hint">nothing unlocked to wager on. the fixtures are sleeping.</p>
      ) : (
        <div className="stack">
          {/* The match. */}
          <div className="field">
            <label className="field-label" htmlFor="composer-match">
              the match
            </label>
            <select
              id="composer-match"
              className="input"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.home_team} vs {m.away_team} — {formatKickoff(m.kickoff_at)}
                </option>
              ))}
            </select>
          </div>

          {/* The side. */}
          <div className="field">
            <span className="field-label" id="composer-side-label">
              your side
            </span>
            <div className="filters" role="group" aria-labelledby="composer-side-label">
              <button
                type="button"
                className={`chip chip--small${pick === 'home' ? ' on' : ''}`}
                onClick={() => choosePick('home')}
              >
                {selected ? selected.home_team : 'home'}
              </button>
              <button
                type="button"
                className={`chip chip--small${pick === 'draw' ? ' on' : ''}`}
                onClick={() => choosePick('draw')}
              >
                draw
              </button>
              <button
                type="button"
                className={`chip chip--small${pick === 'away' ? ' on' : ''}`}
                onClick={() => choosePick('away')}
              >
                {selected ? selected.away_team : 'away'}
              </button>
            </div>
          </div>

          {/* Optional winning margin — sides only, never the draw. */}
          {pick !== 'draw' && (
            <div className="field">
              <span className="field-label">margin (optional)</span>
              <div className="row">
                <button
                  type="button"
                  className={`chip chip--small${withMargin ? ' on' : ''}`}
                  aria-pressed={withMargin}
                  onClick={() => setWithMargin((v) => !v)}
                >
                  {withMargin ? `by ${margin}+ goals` : 'any winning margin'}
                </button>
                {withMargin && (
                  <ScoreStepper
                    label="winning margin in goals"
                    value={margin}
                    onChange={setMargin}
                    min={1}
                    max={10}
                  />
                )}
              </div>
            </div>
          )}

          {/* The boast itself. */}
          <div className="field">
            <label className="field-label" htmlFor="composer-claim">
              the claim, in your own words
            </label>
            <textarea
              id="composer-claim"
              className="input"
              rows={2}
              maxLength={CLAIM_MAX}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="they win this and it isn't close."
            />
            <span className="hint">
              {trimmedClaim.length}/{CLAIM_MAX} — at least {CLAIM_MIN} characters.
            </span>
          </div>

          {err && <p className="form-error">{err}</p>}

          <button type="button" className="btn" onClick={() => void create()} disabled={!canSubmit}>
            {busy ? 'posting…' : 'post it'}
          </button>
        </div>
      )}
    </Modal>
  );
}
