/**
 * BracketView.tsx
 * ----------------------------------------------------------------------------
 * The Tournament Predictor (Contract §11): predict the group stage, then walk
 * the knockout tree from the round of 32 down to a crowned champion — and
 * browse anyone else's prophecy, read-only.
 *
 * Two lenses (chip toggle, like the fixtures filters):
 *   - "group stage": the A–L grid of tap-to-rank GroupCards + the best-thirds
 *     picker (the 8 wildcards that join the round of 32);
 *   - "knockout": a horizontally-snapping rail of rounds that funnels into the
 *     champion — tap a side of any BracketMatchup to advance it; the engine in
 *     lib/bracket.ts cascades the consequences and prunes every pick its
 *     premise no longer supports.
 *
 * Whose prophecy: a people picker (from the leaderboard) flips the whole view
 * between MY editable picks and any other player's READ-ONLY tree. Brackets
 * carry no lock (a season-long living document), so there is nothing to keep
 * secret — the server serves any player's tree to any signed-in caller.
 *
 * State: my three pick documents live HERE (single source); when browsing
 * someone else, their fetched document drives the same pure components with
 * `readOnly`. Data flow per the house pattern: one parallel fetch on mount
 * (matches feed seeds the groups; /api/bracket seeds my picks; leaderboard
 * seeds the people picker), local useState + dirty flag, explicit save. Saving
 * persists the PRUNED bracket picks so stale prophecies never reach the DB.
 * ----------------------------------------------------------------------------
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import BracketMatchup from '../components/BracketMatchup';
import GroupCard from '../components/GroupCard';
import { bracketColumns, groupsFromMatches, resolveBracket } from '../lib/bracket';
import { flagFor } from '../lib/flags';
import { useAuth } from '../state/AuthContext';
import type {
  BracketGroupPicks,
  BracketPrediction,
  BracketSlotPicks,
  BracketThirdPicks,
  MatchWithMine,
  PublicUser,
} from '../types/models';

type LensKey = 'groups' | 'knockout';

const LENSES: ReadonlyArray<{ key: LensKey; label: string }> = [
  { key: 'groups', label: 'group stage' },
  { key: 'knockout', label: 'knockout' },
];

/** Best-third berths available (the 8 best third-placed teams advance). */
const THIRD_BERTHS = 8;

/** Compact column headers for the (space-constrained) knockout tree. */
const ROUND_SHORT: Record<string, string> = {
  R32: 'R32',
  R16: 'R16',
  QF: 'QF',
  SF: 'SF',
  F: 'final',
};

/**
 * Row-units a tie spans in the bracket grid — doubling each round so a tie
 * always lands centred between the two it feeds from (R32 ties stack two-high,
 * R16 four-high, …, the lone SF/final span all sixteen and centre).
 */
const ROUND_SPAN: Record<string, number> = { R32: 2, R16: 4, QF: 8, SF: 16, F: 16 };

/**
 * Connector roles for a flow-column tie's grid cell (see the `.bk-*` rules in
 * almanac.css). The final is NOT a flow cell — it crowns the two middle semis
 * from above and draws its own ⊓ connector.
 *   - side (left/right) picks which edge the lines attach to;
 *   - paired rounds (R32/R16/QF) draw a child arm + half the vertical bus, with
 *     up/down set by the tie's parity within its pair;
 *   - rounds with feeders (R16/QF/SF) draw a parent stub.
 */
function cellClasses(round: string, side: string, index: number): string {
  const cls = ['bk-cell', side === 'left' ? 'bk-left' : 'bk-right'];
  if (round === 'R32' || round === 'R16' || round === 'QF') {
    cls.push('bk-child', index % 2 === 0 ? 'bk-up' : 'bk-down');
  }
  if (round === 'R16' || round === 'QF' || round === 'SF') cls.push('bk-parent');
  return cls.join(' ');
}

export default function BracketView(): JSX.Element {
  const { user } = useAuth();
  const meId = user?.id ?? '';

  // -- data -------------------------------------------------------------------
  const [matches, setMatches] = useState<MatchWithMine[] | null>(null);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [failed, setFailed] = useState<boolean>(false);

  // -- my prophecy (single source of truth for MY picks) ----------------------
  const [groupPicks, setGroupPicks] = useState<BracketGroupPicks>({});
  const [thirdPicks, setThirdPicks] = useState<BracketThirdPicks>([]);
  const [bracketPicks, setBracketPicks] = useState<BracketSlotPicks>({});

  // -- save lifecycle ----------------------------------------------------------
  const [hasSaved, setHasSaved] = useState<boolean>(false); // a row exists server-side
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // -- browsing another player's prophecy (read-only) -------------------------
  const [viewUserId, setViewUserId] = useState<string | null>(null); // null = me
  const [othersBracket, setOthersBracket] = useState<BracketPrediction | null>(null);
  const [viewLoading, setViewLoading] = useState<boolean>(false);
  const [viewErr, setViewErr] = useState<boolean>(false);

  const [lens, setLens] = useState<LensKey>('groups');

  // One parallel fetch on mount; the retry path only runs while nothing has
  // loaded yet (matches === null), so hydration can never clobber edits.
  const load = useCallback(async (): Promise<void> => {
    try {
      const [feed, mine, board] = await Promise.all([
        api.listMatches(),
        api.getBracket(),
        api.leaderboard(),
      ]);
      setMatches(feed);
      setPeople(
        board.map((r) => ({ id: r.user_id, username: r.username, display_name: r.display_name })),
      );
      if (mine.bracket) {
        setHasSaved(true);
        setGroupPicks(mine.bracket.group_picks);
        setThirdPicks(mine.bracket.third_picks);
        setBracketPicks(mine.bracket.bracket_picks);
        setDirty(false);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the viewed player's tree whenever the selection changes to "not me".
  const loadOther = useCallback(async (id: string): Promise<void> => {
    setViewLoading(true);
    setViewErr(false);
    setOthersBracket(null);
    try {
      const res = await api.getUserBracket(id);
      setOthersBracket(res.bracket);
    } catch {
      setViewErr(true);
    } finally {
      setViewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewUserId === null) return; // me — uses local picks, nothing to fetch
    void loadOther(viewUserId);
  }, [viewUserId, loadOther]);

  // -- whose picks drive the render (mine when editing, theirs when browsing) --
  const readOnly = viewUserId !== null;
  const activeGroupPicks = useMemo<BracketGroupPicks>(
    () => (readOnly ? othersBracket?.group_picks ?? {} : groupPicks),
    [readOnly, othersBracket, groupPicks],
  );
  const activeThirdPicks = useMemo<BracketThirdPicks>(
    () => (readOnly ? othersBracket?.third_picks ?? [] : thirdPicks),
    [readOnly, othersBracket, thirdPicks],
  );
  const activeBracketPicks = useMemo<BracketSlotPicks>(
    () => (readOnly ? othersBracket?.bracket_picks ?? {} : bracketPicks),
    [readOnly, othersBracket, bracketPicks],
  );

  // -- derived ----------------------------------------------------------------
  const groups = useMemo(() => (matches ? groupsFromMatches(matches) : []), [matches]);
  const resolved = useMemo(
    () => resolveBracket(activeGroupPicks, activeThirdPicks, activeBracketPicks),
    [activeGroupPicks, activeThirdPicks, activeBracketPicks],
  );
  // The knockout laid out as a two-sided tree. The eight "flow" columns fan out
  // on each wing (R32 R16 QF SF · SF QF R16 R32); the final is lifted out and
  // crowned above the two middle semi-finals.
  const columns = useMemo(() => bracketColumns(resolved), [resolved]);
  const flowColumns = useMemo(() => columns.filter((c) => c.side !== 'center'), [columns]);
  const finalTie = columns.find((c) => c.side === 'center')?.slots[0] ?? null;
  const completeGroups = groups.filter(
    (g) => g.teams.length > 0 && (activeGroupPicks[g.letter] ?? []).length === g.teams.length,
  ).length;

  // The losing finalist, when the final is decided — for the champion hero line.
  const finalSlot = resolved.rounds.find((r) => r.key === 'F')?.slots[0];
  const runnerUp =
    finalSlot && resolved.champion
      ? [finalSlot.home.team, finalSlot.away.team].find((t) => t && t !== resolved.champion) ?? null
      : null;

  const others = people.filter((p) => p.id !== meId);
  const viewingName =
    others.find((p) => p.id === viewUserId)?.username ?? viewUserId ?? 'this player';

  // -- interactions (no-ops while browsing — the components withhold taps) -----
  function changeGroup(letter: string, order: string[]): void {
    setGroupPicks((prev) => ({ ...prev, [letter]: order }));
    setDirty(true);
    setSaveErr(null);
  }

  function toggleThird(letter: string): void {
    setThirdPicks((prev) => {
      if (prev.includes(letter)) return prev.filter((l) => l !== letter);
      if (prev.length >= THIRD_BERTHS) return prev; // all berths taken
      return [...prev, letter];
    });
    setDirty(true);
    setSaveErr(null);
  }

  function pickWinner(slotKey: string, team: string): void {
    setBracketPicks((prev) => {
      const next = { ...prev };
      if (next[slotKey] === team) {
        delete next[slotKey]; // repeat tap = take it back
      } else {
        next[slotKey] = team;
      }
      return next;
    });
    setDirty(true);
    setSaveErr(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveErr(null);
    try {
      // Persist only the picks that survived pruning — stale branches die here.
      const doc = await api.saveBracket({
        group_picks: groupPicks,
        third_picks: thirdPicks,
        bracket_picks: resolved.validBracketPicks,
      });
      setGroupPicks(doc.group_picks);
      setThirdPicks(doc.third_picks);
      setBracketPicks(doc.bracket_picks);
      setHasSaved(true);
      setDirty(false);
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : 'the wire is down. try again.');
    } finally {
      setSaving(false);
    }
  }

  // -- guards -------------------------------------------------------------------
  if (failed && matches === null) return <ErrorCard onRetry={() => void load()} />;
  if (matches === null) return <LoadingCard />;

  const championFlag = resolved.champion ? flagFor(resolved.champion) : null;

  // The progress mini-chips reflect whoever's tree is on screen.
  const progressChips = (
    <>
      <span className="mini-chip">
        {completeGroups}/{groups.length || 12} groups
      </span>
      <span className="mini-chip">
        {activeThirdPicks.length}/{THIRD_BERTHS} thirds
      </span>
      {resolved.champion && <span className="mini-chip">champion · {resolved.champion}</span>}
    </>
  );

  return (
    <div>
      <span className="kicker">the long road</span>
      <h1 className="view-title">the bracket</h1>

      {/* Whose prophecy — "you" plus every other player on the table. */}
      {others.length > 0 && (
        <div className="filters predictor-people" role="group" aria-label="whose bracket">
          <button
            type="button"
            className={`chip chip--small${viewUserId === null ? ' on' : ''}`}
            aria-pressed={viewUserId === null}
            onClick={() => setViewUserId(null)}
          >
            you
          </button>
          {others.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip chip--small${viewUserId === p.id ? ' on' : ''}`}
              aria-pressed={viewUserId === p.id}
              onClick={() => setViewUserId(p.id)}
            >
              @{p.username}
            </button>
          ))}
        </div>
      )}

      {/* Save bar (mine) — or the read-only banner (someone else's). */}
      {readOnly ? (
        <div className="savebar">
          <span className="statechip statechip--teal">viewing</span>
          <span className="hint">@{viewingName}&rsquo;s prophecy · read-only</span>
          <button type="button" className="chip chip--small" onClick={() => setViewUserId(null)}>
            back to yours
          </button>
          {othersBracket && progressChips}
        </div>
      ) : (
        <>
          <div className="savebar">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void save()}
              disabled={saving || !dirty}
            >
              {saving ? 'saving…' : hasSaved ? 'update my bracket' : 'save my bracket'}
            </button>
            {dirty && !saving && <span className="hint">unsaved changes</span>}
            {!dirty && hasSaved && <span className="hint">prophecy on file.</span>}
            {progressChips}
          </div>
          {saveErr && <p className="form-error">{saveErr}</p>}
        </>
      )}

      {/* Lens toggle — same grammar as the fixtures filters. */}
      <div className="filters" role="group" aria-label="predictor section">
        {LENSES.map((l) => (
          <button
            key={l.key}
            type="button"
            className={`chip chip--small${lens === l.key ? ' on' : ''}`}
            aria-pressed={lens === l.key}
            onClick={() => setLens(l.key)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Browsing states: load / error / they have nothing on file yet. */}
      {readOnly && viewErr && (
        <div className="section">
          <ErrorCard onRetry={() => void loadOther(viewUserId!)} />
        </div>
      )}
      {readOnly && !viewErr && viewLoading && <LoadingCard />}
      {readOnly && !viewErr && !viewLoading && othersBracket === null && (
        <div className="section">
          <EmptyState message={`@${viewingName} hasn’t filed a prophecy yet.`} />
        </div>
      )}

      {/* The predictor body — shown for my tree, or a loaded other's tree. */}
      {(!readOnly || (othersBracket !== null && !viewLoading && !viewErr)) && (
        <>
          {/* ---- group stage lens --------------------------------------------- */}
          {lens === 'groups' && (
            <div className="section">
              {groups.length === 0 && (
                <EmptyState message="no groups on the books yet. the ingest checks in soon." />
              )}

              {groups.length > 0 && (
                <>
                  <div className="group-grid">
                    {groups.map((g) => (
                      <GroupCard
                        key={g.letter}
                        group={g}
                        order={activeGroupPicks[g.letter] ?? []}
                        thirdAdvances={activeThirdPicks.includes(g.letter)}
                        onChange={(order) => changeGroup(g.letter, order)}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>

                  {/* Best-thirds picker: 8 wildcards from the 12 third places. */}
                  <div className="section">
                    <section className="card group-card" aria-label="best thirds">
                      <div className="group-head">
                        <span className="kicker">
                          best thirds · {activeThirdPicks.length}/{THIRD_BERTHS}
                        </span>
                        {!readOnly && thirdPicks.length > 0 && (
                          <button
                            type="button"
                            className="chip chip--small"
                            onClick={() => {
                              setThirdPicks([]);
                              setDirty(true);
                              setSaveErr(null);
                            }}
                          >
                            reset
                          </button>
                        )}
                      </div>
                      <p className="hint">
                        {readOnly
                          ? 'the eight third-placed sides they sent into the round of 32.'
                          : 'pick the eight third-placed sides that sneak into the round of 32.'}
                      </p>
                      <div className="thirds-chips">
                        {groups.map((g) => {
                          const third = (activeGroupPicks[g.letter] ?? [])[2] ?? null;
                          const on = activeThirdPicks.includes(g.letter);
                          return (
                            <button
                              key={g.letter}
                              type="button"
                              className={`chip chip--small${on ? ' on' : ''}`}
                              aria-pressed={on}
                              disabled={
                                readOnly ||
                                third === null ||
                                (!on && activeThirdPicks.length >= THIRD_BERTHS)
                              }
                              onClick={readOnly ? undefined : () => toggleThird(g.letter)}
                            >
                              {g.letter.toLowerCase()} · {third ?? 'tbd'}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---- knockout lens ------------------------------------------------- */}
          {lens === 'knockout' && (
            <div className="section">
              {resolved.champion && (
                <div className="card card--hero champion-card">
                  <span className="champion-trophy" aria-hidden="true">
                    🏆
                  </span>
                  <span className="kicker">the champion</span>
                  <span className="champion-name">
                    {championFlag ? `${championFlag} ` : ''}
                    {resolved.champion}
                  </span>
                  {runnerUp && <span className="hint">over {runnerUp} in the final</span>}
                  <span className="statechip statechip--gold">crowned</span>
                </div>
              )}

              <div className="bracket-scroll">
                <div className="bracket-grid">
                  {flowColumns.map((col, fi) => {
                    const span = ROUND_SPAN[col.round] ?? 2;
                    const decided = col.slots.filter((s) => s.pick !== null).length;
                    const gc = `${fi + 1}`;
                    return (
                      <Fragment key={col.key}>
                        <div
                          className="bk-head"
                          style={{ gridColumn: gc, gridRow: '1' }}
                          aria-label={`${col.label}, ${col.side} half`}
                        >
                          <span className="kicker">{ROUND_SHORT[col.round] ?? col.label}</span>
                          {col.slots.length > 0 && (
                            <span className="bk-count">
                              {decided}/{col.slots.length}
                            </span>
                          )}
                        </div>
                        {col.slots.map((slot, i) => (
                          <div
                            key={slot.key}
                            className={cellClasses(col.round, col.side, i)}
                            style={{ gridColumn: gc, gridRow: `${2 + i * span} / span ${span}` }}
                          >
                            <BracketMatchup
                              slot={slot}
                              onPick={(team) => pickWinner(slot.key, team)}
                              readOnly={readOnly}
                            />
                          </div>
                        ))}
                      </Fragment>
                    );
                  })}

                  {/* The final crowns the two middle semis from above, capped by
                      a ⊓ connector dropping onto both. */}
                  {finalTie && (
                    <div
                      className="bk-finalcell"
                      style={{ gridColumn: '4 / span 2', gridRow: '2 / span 8' }}
                    >
                      <span className="kicker bk-final-label">the final</span>
                      <BracketMatchup
                        slot={finalTie}
                        onPick={(team) => pickWinner(finalTie.key, team)}
                        readOnly={readOnly}
                      />
                      <div className="bk-final-conn" aria-hidden="true" />
                    </div>
                  )}
                </div>
              </div>
              {!readOnly && (
                <p className="hint">
                  tap a side to send it through; tap it again to take it back. undecided slots fill
                  in as the group stage above gets called.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
