/**
 * NextUpWidget.tsx
 * ----------------------------------------------------------------------------
 * The Hub's "Actionable Prompt" (CONTRACT §7.4): the chronologically next
 * unlocked match (GET /api/matches/next, fetched by HubView) with an inline
 * ScoreStepper per side (0–20, Fraunces 900 numerals), a save button, a
 * "your call: Brazil 2 – 1 France" line once saved, and a live countdown
 * beneath. Editable right up to lock_at.
 *
 * When nothing is upcoming: a quiet card — "nothing to call. the almanac
 * rests."
 *
 * The countdown ticks on a 1 s (1 000 ms) interval, cleared on unmount.
 * HubView keys this widget by match id so a new "next" match remounts it with
 * fresh stepper state.
 * ----------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatCountdown, formatKickoff, isLocked } from '../lib/datetime';
import type { MatchWithMine, Prediction } from '../types/models';
import ScoreStepper from './ScoreStepper';

interface NextUpWidgetProps {
  /** The next unlocked match, or null when the calendar is empty. */
  match: MatchWithMine | null;
  /** Bubbled after a successful save so the Hub can quietly refresh. */
  onSaved?: (prediction: Prediction) => void;
}

export default function NextUpWidget({ match, onSaved }: NextUpWidgetProps): JSX.Element {
  // -- 1 s countdown clock (hooks must run unconditionally) -------------------
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000); // 1 s tick
    return () => window.clearInterval(id);
  }, []);

  // -- prediction editing ------------------------------------------------------
  const [predHome, setPredHome] = useState<number>(match?.my_prediction?.pred_home ?? 0);
  const [predAway, setPredAway] = useState<number>(match?.my_prediction?.pred_away ?? 0);
  const [saved, setSaved] = useState<Prediction | null>(match?.my_prediction ?? null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Adopt fresher server copies without clobbering in-progress edits.
  useEffect(() => {
    const mine = match?.my_prediction;
    if (!mine || dirty) return;
    if (saved && Date.parse(saved.updated_at) > Date.parse(mine.updated_at)) return;
    setPredHome(mine.pred_home);
    setPredAway(mine.pred_away);
    setSaved(mine);
  }, [match?.my_prediction, dirty, saved]);

  // Quiet card when the calendar has nothing left to call.
  if (!match) {
    return (
      <section className="card nextup">
        <span className="kicker">next up</span>
        <p className="hint">nothing to call. the almanac rests.</p>
      </section>
    );
  }

  const now = new Date(nowMs);
  const locked = isLocked(match, now);
  const mine = saved ?? match.my_prediction;

  async function save(): Promise<void> {
    if (!match) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const p = await api.upsertPrediction({
        match_id: match.id,
        pred_home: predHome,
        pred_away: predAway,
      });
      setSaved(p);
      setDirty(false);
      onSaved?.(p);
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : 'the wire is down. try again.');
    } finally {
      setSaving(false);
    }
  }

  const meta = [match.group_label, match.venue].filter(Boolean).join(' · ');

  return (
    <section className="card card--hero nextup">
      <span className="kicker">next up</span>

      <div className="match-teams">
        <span className="team-name">{match.home_team}</span>
        <span className="match-vs">vs</span>
        <span className="team-name team-name--away">{match.away_team}</span>
      </div>

      <p className="hint">
        {formatKickoff(match.kickoff_at, now)}
        {meta && ` · ${meta}`}
      </p>

      {/* Inline steppers — editable until lock, then the door shuts. */}
      {!locked ? (
        <div className="stepper-pair">
          <div className="stepper-side">
            <span className="hint">{match.home_team}</span>
            <ScoreStepper
              label={`${match.home_team} goals`}
              value={predHome}
              onChange={(n) => {
                setPredHome(n);
                setDirty(true);
              }}
              disabled={saving}
            />
          </div>
          <div className="stepper-side">
            <span className="hint">{match.away_team}</span>
            <ScoreStepper
              label={`${match.away_team} goals`}
              value={predAway}
              onChange={(n) => {
                setPredAway(n);
                setDirty(true);
              }}
              disabled={saving}
            />
          </div>
          <button type="button" className="btn btn--small" onClick={() => void save()} disabled={saving}>
            {saving ? 'saving…' : mine ? 'update my call' : 'save my call'}
          </button>
        </div>
      ) : (
        <p className="hint">locked. the ball is rolling.</p>
      )}
      {saveErr && <p className="form-error">{saveErr}</p>}

      {mine && (
        <p className="nextup-call">
          your call: {match.home_team} {mine.pred_home} – {mine.pred_away} {match.away_team}
        </p>
      )}

      {/* Live countdown line — "kicks off in 2 h 05 min" / "in 3 days" / "locked". */}
      <p className="nextup-count">{formatCountdown(match.kickoff_at, now)}</p>
    </section>
  );
}
