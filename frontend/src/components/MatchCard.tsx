/**
 * MatchCard.tsx
 * ----------------------------------------------------------------------------
 * One fixture as a paper object (CONTRACT §7.4 "Match feed"):
 *   - header: jewel StateChip, local kickoff via formatKickoff, group/venue
 *     small print;
 *   - teams set in Fraunces 600; the final score in Fraunces 900;
 *   - until lock: an inline ScoreStepper pair + save button (predictions are
 *     editable right up to lock_at, then the server answers 409 MATCH_LOCKED);
 *   - once locked: "locked. the ball is rolling." plus my saved call;
 *   - once final: my earned points badge (+5 exact / +2 outcome / 0);
 *   - locked/final cards expose "the table's calls" — everyone's revealed
 *     predictions, fetched lazily on first expand (server enforces secrecy
 *     before lock; the UI only offers the expander after it).
 *
 * The `hero` flag applies the featured "Main Event" treatment: --hero paper,
 * bigger Fraunces type, same 1.5px ink border + 6px hard shadow.
 *
 * A light 30 s (30 000 ms) ticker re-evaluates lock/display state so a card
 * left on screen flips from editable → locked → live without a reload.
 * ----------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { displayState, formatKickoff, isLocked } from '../lib/datetime';
import { flagFor } from '../lib/flags';
import type { MatchWithMine, Prediction } from '../types/models';
import PointsBadge from './PointsBadge';
import ScoreStepper from './ScoreStepper';
import StateChip from './StateChip';
import TableCalls from './TableCalls';

interface MatchCardProps {
  match: MatchWithMine;
  /** Featured "Main Event" hero treatment. */
  hero?: boolean;
  /** Bubbled after a successful save so parents can quietly refresh. */
  onSaved?: (prediction: Prediction) => void;
}

export default function MatchCard({ match, hero = false, onSaved }: MatchCardProps): JSX.Element {
  // -- clock ----------------------------------------------------------------
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (match.status === 'final') return; // settled cards never change state
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000); // 30 s
    return () => window.clearInterval(id);
  }, [match.status]);

  const now = new Date(nowMs);
  const locked = isLocked(match, now);
  const state = displayState(match, now);

  // -- prediction editing ---------------------------------------------------
  const [predHome, setPredHome] = useState<number>(match.my_prediction?.pred_home ?? 0);
  const [predAway, setPredAway] = useState<number>(match.my_prediction?.pred_away ?? 0);
  const [saved, setSaved] = useState<Prediction | null>(match.my_prediction);
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Adopt fresher server copies (60 s refetches) — but never clobber unsaved
  // stepper edits, and never regress to a copy older than what we just saved.
  useEffect(() => {
    const mine = match.my_prediction;
    if (!mine || dirty) return;
    if (saved && Date.parse(saved.updated_at) > Date.parse(mine.updated_at)) return;
    setPredHome(mine.pred_home);
    setPredAway(mine.pred_away);
    setSaved(mine);
  }, [match.my_prediction, dirty, saved]);

  async function save(): Promise<void> {
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

  // -- render -----------------------------------------------------------------
  const mine = saved ?? match.my_prediction;
  const meta = [match.group_label, match.venue].filter(Boolean).join(' · ');
  const showScore = state === 'final' && match.home_score !== null && match.away_score !== null;
  const homeFlag = flagFor(match.home_team);
  const awayFlag = flagFor(match.away_team);

  return (
    <article className={`card match-card${hero ? ' card--hero match-card--hero' : ''}`}>
      <div className="match-meta">
        <StateChip kind={state} />
        <span className="hint">{formatKickoff(match.kickoff_at, now)}</span>
        {meta && <span className="hint match-venue">{meta}</span>}
      </div>

      <div className="match-teams">
        <span className="team-name">
          {homeFlag && (
            <span className="team-name-flag" aria-hidden="true">
              {homeFlag}{' '}
            </span>
          )}
          {match.home_team}
        </span>
        {showScore ? (
          <span className="match-score">
            {match.home_score} – {match.away_score}
          </span>
        ) : (
          <span className="match-vs">vs</span>
        )}
        <span className="team-name team-name--away">
          {match.away_team}
          {awayFlag && (
            <span className="team-name-flag" aria-hidden="true">
              {' '}
              {awayFlag}
            </span>
          )}
        </span>
      </div>

      {/* Editable until lock: stepper pair + save. */}
      {!locked && state !== 'final' && (
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
      )}
      {saveErr && <p className="form-error">{saveErr}</p>}

      {/* Locked but not settled: the door is shut, the ball is in play. */}
      {locked && state !== 'final' && <p className="hint">locked. the ball is rolling.</p>}

      {/* My saved call, plus the points it earned once the match is final. */}
      {mine && (
        <div className="match-result">
          <span className="match-callline">
            your call: {match.home_team} {mine.pred_home} – {mine.pred_away} {match.away_team}
          </span>
          {state === 'final' && <PointsBadge points={mine.points_awarded} />}
        </div>
      )}

      {/* The table's calls — commit-to-reveal: open once the match locks or
          once I've made my own call. Before that TableCalls shows the nudge. */}
      <TableCalls
        matchId={match.id}
        revealed={locked || mine !== null}
        final={state === 'final'}
        live={!locked}
      />
    </article>
  );
}
