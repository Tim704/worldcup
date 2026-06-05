/**
 * MatchPredictionCenter.tsx
 * ----------------------------------------------------------------------------
 * World Cup 2026 Fantasy Hub — "Broadcast Editorial" Match Prediction Center.
 *
 * Aesthetic direction: live-TV scorebug meets sports-magazine print. Warm
 * newsprint canvas, near-black ink, a vermillion signal accent and an electric
 * volt-lime "live" accent. Oversized Anton display caps, Space Mono data ticks,
 * Archivo body. Hard offset shadows, diagonal clip-path color blocks, a running
 * ticker — no soft blurry "dashboard" gradients anywhere.
 *
 * Self-contained: all styles are injected via a single <style> block and the
 * three Google Fonts are loaded on mount, so this drops into any React + TS app
 * with zero extra dependencies. Default export is the page component.
 *
 * Core loop: pick a scoreline for an upcoming fixture (vertical broadcast
 * steppers) → watch the community crowd-split + your potential points react →
 * LOCK IT IN → it lands on your slip with points-in-play. Kickoff locks editing.
 *
 * Measurements use the metric system per project mandate (distances in km, etc.
 * where they appear). All sizing is responsive via clamp().
 * ----------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useState } from 'react';

/* ===========================================================================
 * Domain model
 * ======================================================================== */

type Status = 'LIVE' | 'UPCOMING';
type FormResult = 'W' | 'D' | 'L';
type Outcome = 'H' | 'D' | 'A';

interface Team {
  code: string;          // 3-letter broadcast code, e.g. "ARG"
  name: string;          // full nation name
  flag: string;          // emoji flag (identity carried by code+colour regardless of render)
  color: string;         // primary kit colour for the diagonal scorebug block
  form: FormResult[];    // last 5, oldest→newest
  rank: number;          // FIFA-style seeding, purely flavour
}

interface Fixture {
  id: string;
  fxCode: string;        // broadcast fixture id, e.g. "FX-001"
  group: string;         // "GROUP F"
  home: Team;
  away: Team;
  venue: string;
  city: string;
  hostFlag: string;
  status: Status;
  /** minutes from mount until kickoff; negative ⇒ already underway */
  offsetMin: number;
  liveMinute?: number;   // current match minute when LIVE
  liveScore?: [number, number];
  crowd: { home: number; draw: number; away: number }; // community split, sums to 100
  h2h: { home: number; draw: number; away: number };   // historical meetings
}

interface Pick { h: number; a: number }

/* ===========================================================================
 * Fixture data — World Cup 2026, host venues across 🇺🇸 🇨🇦 🇲🇽
 * (Groupings are illustrative; colours chosen for high broadcast contrast.)
 * ======================================================================== */

const ARG: Team = { code: 'ARG', name: 'Argentina',   flag: '🇦🇷', color: '#6fa8dc', rank: 1,  form: ['W', 'W', 'D', 'W', 'W'] };
const MEX: Team = { code: 'MEX', name: 'Mexico',       flag: '🇲🇽', color: '#1f8a4c', rank: 12, form: ['W', 'D', 'W', 'L', 'W'] };
const USA: Team = { code: 'USA', name: 'United States',flag: '🇺🇸', color: '#16386e', rank: 11, form: ['W', 'L', 'W', 'W', 'D'] };
const NED: Team = { code: 'NED', name: 'Netherlands',  flag: '🇳🇱', color: '#ff6a00', rank: 6,  form: ['D', 'W', 'W', 'D', 'W'] };
const BRA: Team = { code: 'BRA', name: 'Brazil',       flag: '🇧🇷', color: '#f2c200', rank: 3,  form: ['W', 'W', 'W', 'D', 'W'] };
const CRO: Team = { code: 'CRO', name: 'Croatia',      flag: '🇭🇷', color: '#d81e2c', rank: 9,  form: ['L', 'D', 'W', 'W', 'D'] };
const FRA: Team = { code: 'FRA', name: 'France',       flag: '🇫🇷', color: '#1b4fa0', rank: 2,  form: ['W', 'W', 'L', 'W', 'W'] };
const MAR: Team = { code: 'MAR', name: 'Morocco',      flag: '🇲🇦', color: '#1f7a4d', rank: 13, form: ['W', 'D', 'D', 'W', 'L'] };
const ENG: Team = { code: 'ENG', name: 'England',      flag: '🏴', color: '#1a2c6b', rank: 4,  form: ['W', 'W', 'D', 'W', 'D'] };
const SEN: Team = { code: 'SEN', name: 'Senegal',      flag: '🇸🇳', color: '#18935a', rank: 17, form: ['D', 'W', 'L', 'W', 'W'] };
const ESP: Team = { code: 'ESP', name: 'Spain',        flag: '🇪🇸', color: '#c41e2b', rank: 5,  form: ['W', 'W', 'W', 'W', 'D'] };
const JPN: Team = { code: 'JPN', name: 'Japan',        flag: '🇯🇵', color: '#17306e', rank: 18, form: ['W', 'L', 'W', 'D', 'W'] };
const CAN: Team = { code: 'CAN', name: 'Canada',       flag: '🇨🇦', color: '#e23b2e', rank: 24, form: ['L', 'W', 'D', 'L', 'W'] };
const KOR: Team = { code: 'KOR', name: 'South Korea',  flag: '🇰🇷', color: '#1e4f9e', rank: 22, form: ['D', 'D', 'W', 'W', 'L'] };
const POR: Team = { code: 'POR', name: 'Portugal',     flag: '🇵🇹', color: '#c8102e', rank: 7,  form: ['W', 'W', 'D', 'W', 'W'] };
const URU: Team = { code: 'URU', name: 'Uruguay',      flag: '🇺🇾', color: '#2e5bb8', rank: 14, form: ['W', 'D', 'L', 'W', 'D'] };

const FIXTURES: Fixture[] = [
  {
    id: 'arg-mex', fxCode: 'FX-001', group: 'GROUP F', home: ARG, away: MEX,
    venue: 'Estadio Azteca', city: 'Mexico City', hostFlag: '🇲🇽',
    status: 'UPCOMING', offsetMin: 134,
    crowd: { home: 71, draw: 17, away: 12 }, h2h: { home: 16, draw: 14, away: 9 },
  },
  {
    id: 'bra-cro', fxCode: 'FX-002', group: 'GROUP H', home: BRA, away: CRO,
    venue: 'MetLife Stadium', city: 'New York / NJ', hostFlag: '🇺🇸',
    status: 'LIVE', offsetMin: -67, liveMinute: 67, liveScore: [1, 0],
    crowd: { home: 58, draw: 24, away: 18 }, h2h: { home: 4, draw: 3, away: 1 },
  },
  {
    id: 'usa-ned', fxCode: 'FX-003', group: 'GROUP D', home: USA, away: NED,
    venue: 'SoFi Stadium', city: 'Los Angeles', hostFlag: '🇺🇸',
    status: 'UPCOMING', offsetMin: 295,
    crowd: { home: 33, draw: 28, away: 39 }, h2h: { home: 1, draw: 1, away: 4 },
  },
  {
    id: 'fra-mar', fxCode: 'FX-004', group: 'GROUP C', home: FRA, away: MAR,
    venue: 'AT&T Stadium', city: 'Dallas', hostFlag: '🇺🇸',
    status: 'UPCOMING', offsetMin: 470,
    crowd: { home: 54, draw: 27, away: 19 }, h2h: { home: 6, draw: 2, away: 3 },
  },
  {
    id: 'eng-sen', fxCode: 'FX-005', group: 'GROUP E', home: ENG, away: SEN,
    venue: 'Mercedes-Benz Stadium', city: 'Atlanta', hostFlag: '🇺🇸',
    status: 'UPCOMING', offsetMin: 1325,
    crowd: { home: 49, draw: 29, away: 22 }, h2h: { home: 1, draw: 0, away: 0 },
  },
  {
    id: 'esp-jpn', fxCode: 'FX-006', group: 'GROUP G', home: ESP, away: JPN,
    venue: 'Hard Rock Stadium', city: 'Miami', hostFlag: '🇺🇸',
    status: 'UPCOMING', offsetMin: 1490,
    crowd: { home: 56, draw: 26, away: 18 }, h2h: { home: 2, draw: 1, away: 1 },
  },
  {
    id: 'can-kor', fxCode: 'FX-007', group: 'GROUP B', home: CAN, away: KOR,
    venue: 'BC Place', city: 'Vancouver', hostFlag: '🇨🇦',
    status: 'UPCOMING', offsetMin: 1655,
    crowd: { home: 38, draw: 31, away: 31 }, h2h: { home: 0, draw: 2, away: 2 },
  },
  {
    id: 'por-uru', fxCode: 'FX-008', group: 'GROUP I', home: POR, away: URU,
    venue: 'Lumen Field', city: 'Seattle', hostFlag: '🇺🇸',
    status: 'UPCOMING', offsetMin: 1820,
    crowd: { home: 47, draw: 28, away: 25 }, h2h: { home: 3, draw: 2, away: 2 },
  },
];

/* Pre-seeded predictions so the slip + the picked preview have life on load. */
const INITIAL_PICKS: Record<string, Pick> = {
  'arg-mex': { h: 2, a: 1 }, // mirrors the chosen design preview
  'eng-sen': { h: 2, a: 0 },
  'fra-mar': { h: 1, a: 1 },
};
const INITIAL_LOCKED = new Set<string>(['eng-sen', 'fra-mar']);

/* ===========================================================================
 * Scoring engine (pure)
 * ======================================================================== */

const outcomeOf = (h: number, a: number): Outcome => (h > a ? 'H' : h < a ? 'A' : 'D');

/** Max points a pick can earn (exact hit), with a contrarian bonus vs the crowd. */
function maxPoints(fx: Fixture, pick: Pick): number {
  const r = outcomeOf(pick.h, pick.a);
  const crowdForOutcome = r === 'H' ? fx.crowd.home : r === 'A' ? fx.crowd.away : fx.crowd.draw;
  let pts = 5; // exact scoreline
  if (crowdForOutcome < 25) pts += 3;
  else if (crowdForOutcome < 38) pts += 1;
  return pts;
}

/** Editorial risk label derived from how popular your called outcome is. */
function riskBand(fx: Fixture, pick: Pick): { label: string; tone: 'bold' | 'spicy' | 'chalk' } {
  const r = outcomeOf(pick.h, pick.a);
  const crowdForOutcome = r === 'H' ? fx.crowd.home : r === 'A' ? fx.crowd.away : fx.crowd.draw;
  if (crowdForOutcome < 25) return { label: 'BOLD CALL', tone: 'bold' };
  if (crowdForOutcome < 40) return { label: 'SPICY', tone: 'spicy' };
  return { label: 'CHALK', tone: 'chalk' };
}

const clampScore = (n: number) => Math.max(0, Math.min(9, n));
const decimalOdds = (pct: number) => (pct <= 0 ? '—' : (100 / pct * 0.92).toFixed(2));

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'KICKOFF';
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function MatchPredictionCenter(): React.ReactElement {
  const [picks, setPicks] = useState<Record<string, Pick>>(INITIAL_PICKS);
  const [locked, setLocked] = useState<Set<string>>(INITIAL_LOCKED);
  const [selectedId, setSelectedId] = useState<string>('arg-mex');
  const [activeRound, setActiveRound] = useState<number>(3);
  const [now, setNow] = useState<number>(() => Date.now());

  // Kickoff timestamps are pinned once on mount so the countdown is stable.
  const [kickoffs] = useState<Record<string, number>>(() => {
    const base = Date.now();
    return Object.fromEntries(FIXTURES.map((f) => [f.id, base + f.offsetMin * 60_000]));
  });

  // Load the three display fonts (Anton / Archivo / Space Mono) once.
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const add = (rel: string, href: string, cross?: boolean) => {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = rel; l.href = href;
      if (cross) l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
      links.push(l);
    };
    add('preconnect', 'https://fonts.googleapis.com');
    add('preconnect', 'https://fonts.gstatic.com', true);
    add('stylesheet',
      'https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
    return () => links.forEach((l) => l.remove());
  }, []);

  // 1 Hz tick drives the kickoff countdown + the blinking live indicators.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const selected = FIXTURES.find((f) => f.id === selectedId)!;
  const pick = picks[selected.id] ?? { h: 0, a: 0 };
  const isLive = selected.status === 'LIVE';
  const isLocked = locked.has(selected.id) || isLive;
  const editable = !isLocked;

  const bump = (side: 'h' | 'a', delta: number) => {
    if (!editable) return;
    setPicks((prev) => {
      const cur = prev[selected.id] ?? { h: 0, a: 0 };
      return { ...prev, [selected.id]: { ...cur, [side]: clampScore(cur[side] + delta) } };
    });
  };

  const toggleLock = () => {
    if (isLive) return;
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(selected.id)) next.delete(selected.id);
      else {
        next.add(selected.id);
        if (!picks[selected.id]) setPicks((p) => ({ ...p, [selected.id]: { h: 0, a: 0 } }));
      }
      return next;
    });
  };

  // Slip aggregates: points in play, locked count (= streak flavour), accuracy.
  const slip = useMemo(() => {
    const ids = [...locked];
    const items = ids.map((id) => {
      const fx = FIXTURES.find((f) => f.id === id)!;
      const pk = picks[id] ?? { h: 0, a: 0 };
      return { fx, pk, pts: maxPoints(fx, pk) };
    });
    const inPlay = items.reduce((s, i) => s + i.pts, 0);
    return { items, inPlay, count: ids.length };
  }, [locked, picks]);

  const totalPredicted = Object.keys(picks).length;
  const myPoints = 184 + slip.inPlay; // a believable running season total + this round in play

  const selOutcome = outcomeOf(pick.h, pick.a);
  const risk = riskBand(selected, pick);
  const countdownMs = kickoffs[selected.id] - now;

  const themeVars = {
    ['--home' as string]: selected.home.color,
    ['--away' as string]: selected.away.color,
  } as React.CSSProperties;

  /* --------------------------------------------------------------------- */

  return (
    <div className="mpc">
      <style>{CSS}</style>

      <div className="mpc-shell">
        {/* ───────── Top broadcast bar ───────── */}
        <header className="mpc-top">
          <div className="mpc-brand">
            <div className="mpc-mark" aria-hidden>26</div>
            <div className="mpc-word">
              World&nbsp;Cup&nbsp;Hub
              <small>FX · PREDICTOR · NORTH AMERICA ’26</small>
            </div>
          </div>

          <div className="mpc-top-right">
            <div className="mpc-md" role="tablist" aria-label="Matchday">
              {[1, 2, 3, 4].map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={activeRound === r}
                  className={activeRound === r ? 'on' : ''}
                  onClick={() => setActiveRound(r)}
                >
                  MD{String(r).padStart(2, '0')}
                </button>
              ))}
            </div>
            <div className="mpc-points" aria-label={`Season points ${myPoints}`}>
              <span>◇ {myPoints} PTS</span>
            </div>
            <div className="mpc-clock" aria-hidden>
              LIVE&nbsp;<b className={now % 2000 < 1000 ? 'on' : ''}>●</b>
            </div>
          </div>
        </header>

        {/* ───────── Running ticker ───────── */}
        <div className="mpc-ticker" aria-hidden>
          <div className="track">
            {[0, 1].map((k) => (
              <React.Fragment key={k}>
                <span className="hot">⚽ BRA 1–0 CRO · 67′ — RAPHINHA STRIKES</span>
                <span className="dot">◆</span>
                <span>AZTECA SELLOUT · 87,000 IN · ARG XI CONFIRMED</span>
                <span className="dot">◆</span>
                <span>USA v NED — TEAM NEWS DROPS IN 4H 55M</span>
                <span className="dot">◆</span>
                <span className="hot">CROWD BACKS ARGENTINA · 71% TO WIN GROUP F</span>
                <span className="dot">◆</span>
                <span>GLOBAL PREDICTORS ONLINE · 2.4M</span>
                <span className="dot">◆</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ───────── Stage ───────── */}
        <main className="mpc-stage">
          {/* ── Left: hero scorebug + meta ── */}
          <div className="mpc-hero">
            <section className="mpc-bug" style={themeVars} aria-label="Prediction scorebug">
              <div className="blocks" aria-hidden>
                <div className="blk h" />
                <div className="blk a" />
                <div className="seam" />
              </div>

              {isLocked && !isLive && (
                <div className="stamp" aria-hidden>LOCKED IN</div>
              )}

              {/* meta strip */}
              <div className="bug-strip">
                <span><span className="grp">{selected.group}</span> · {selected.fxCode}</span>
                <span>{selected.hostFlag} {selected.venue} · {selected.city}</span>
                {isLive ? (
                  <span className="live-badge">
                    <b className={now % 1200 < 600 ? 'on' : ''}>●</b> LIVE&nbsp;{selected.liveMinute}′
                  </span>
                ) : (
                  <span className="up-badge">⌁ KICKOFF&nbsp;{formatCountdown(countdownMs)}</span>
                )}
              </div>

              {/* matchup */}
              <div className="bug-match">
                <div className="team home">
                  <span className="flag">{selected.home.flag}</span>
                  <span className="code">{selected.home.code}</span>
                  <span className="name">{selected.home.name} · #{selected.home.rank}</span>
                </div>

                <div className="bug-score">
                  <ScoreColumn
                    value={isLive ? selected.liveScore![0] : pick.h}
                    editable={editable}
                    label={selected.home.code}
                    onBump={(d) => bump('h', d)}
                  />
                  <span className="score-dash">–</span>
                  <ScoreColumn
                    value={isLive ? selected.liveScore![1] : pick.a}
                    editable={editable}
                    label={selected.away.code}
                    onBump={(d) => bump('a', d)}
                  />
                </div>

                <div className="team away">
                  <span className="flag">{selected.away.flag}</span>
                  <span className="code">{selected.away.code}</span>
                  <span className="name">{selected.away.name} · #{selected.away.rank}</span>
                </div>
              </div>

              {/* crowd split */}
              <div className="split">
                <div className="split-head">
                  <span>{isLive ? 'LIVE WIN PROBABILITY' : 'WHERE THE CROWD STANDS'}</span>
                  <span>{(2_400_000).toLocaleString()} PREDICTIONS</span>
                </div>
                <div className="split-bar">
                  <div className="split-seg seg-h" style={{ width: `${selected.crowd.home}%` }} />
                  <div className="split-seg seg-d" style={{ width: `${selected.crowd.draw}%` }} />
                  <div className="split-seg seg-a" style={{ width: `${selected.crowd.away}%` }} />
                </div>
                <div className="split-legend">
                  <div className={!isLive && selOutcome === 'H' ? 'pick' : ''}>
                    {selected.home.code}&nbsp;<span className="pct">{selected.crowd.home}</span>%
                    {!isLive && selOutcome === 'H' && <em>◄ YOUR CALL</em>}
                  </div>
                  <div className={`mid ${!isLive && selOutcome === 'D' ? 'pick' : ''}`}>
                    DRAW&nbsp;<span className="pct">{selected.crowd.draw}</span>%
                    {!isLive && selOutcome === 'D' && <em>◄ YOUR CALL</em>}
                  </div>
                  <div className={!isLive && selOutcome === 'A' ? 'pick' : ''}>
                    {!isLive && selOutcome === 'A' && <em>YOUR CALL ►</em>}
                    {selected.away.code}&nbsp;<span className="pct">{selected.crowd.away}</span>%
                  </div>
                </div>
              </div>

              {/* actions */}
              <div className="bug-actions">
                {isLive ? (
                  <div className="potential">
                    YOUR LOCKED CALL&nbsp;
                    <b>{(picks[selected.id]?.h ?? '–')}–{(picks[selected.id]?.a ?? '–')}</b>
                    &nbsp;· SETTLES AT FULL-TIME
                  </div>
                ) : (
                  <>
                    <div className="potential">
                      POTENTIAL&nbsp;<b>+{maxPoints(selected, pick)}</b>&nbsp;PTS
                    </div>
                    <span className={`risk risk-${risk.tone}`}>{risk.label}</span>
                    <div className="odds" aria-hidden>
                      {decimalOdds(selected.crowd.home)} / {decimalOdds(selected.crowd.draw)} / {decimalOdds(selected.crowd.away)}
                    </div>
                  </>
                )}

                {!isLive && (
                  <button
                    className={`lock-btn ${isLocked ? 'is-locked' : ''}`}
                    onClick={toggleLock}
                  >
                    <span>{isLocked ? 'EDIT PICK ↺' : 'LOCK PREDICTION →'}</span>
                  </button>
                )}
              </div>
            </section>

            {/* form + head-to-head */}
            <div className="mpc-meta">
              <div className="meta-card">
                <h4>RECENT FORM · LAST 5</h4>
                {[selected.home, selected.away].map((t) => (
                  <div className="form-row" key={t.code}>
                    <span className="who">{t.flag} {t.code}</span>
                    <span className="form-chips">
                      {t.form.map((r, i) => (
                        <span className={`chip ${r}`} key={i}>{r}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>

              <div className="meta-card">
                <h4>HEAD TO HEAD · ALL-TIME</h4>
                <div className="h2h">
                  <div>{selected.h2h.home}<small>{selected.home.code} WINS</small></div>
                  <div>{selected.h2h.draw}<small>DRAWS</small></div>
                  <div>{selected.h2h.away}<small>{selected.away.code} WINS</small></div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: slip + queue ── */}
          <aside className="mpc-rail">
            <section className="slip" aria-label="Your prediction slip">
              <div className="slip-head">
                <h3>Your Slip</h3>
                <span className="tag">MD{String(activeRound).padStart(2, '0')} · {selected.hostFlag}</span>
              </div>
              <div className="slip-stats">
                <div className="slip-stat">
                  <div className="v">+{slip.inPlay}</div>
                  <div className="k">Points in play</div>
                </div>
                <div className="slip-stat">
                  <div className="v">🔥{slip.count}</div>
                  <div className="k">Lock streak</div>
                </div>
                <div className="slip-stat">
                  <div className="v">{totalPredicted}/{FIXTURES.length}</div>
                  <div className="k">Round set</div>
                </div>
              </div>
              <div className="slip-list">
                {slip.items.length === 0 && (
                  <div className="slip-empty">No locked picks yet — lock one to bank points.</div>
                )}
                {slip.items.map(({ fx, pk, pts }) => (
                  <button
                    key={fx.id}
                    className="slip-item"
                    onClick={() => setSelectedId(fx.id)}
                  >
                    <span>{fx.home.flag} {fx.home.code} <span className="res">{pk.h}–{pk.a}</span> {fx.away.code} {fx.away.flag}</span>
                    <span className="pts">+{pts}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="queue" aria-label="Matchday queue">
              <div className="queue-head">
                <h3>Matchday Queue</h3>
                <span className="queue-meta">{FIXTURES.length} FIXTURES</span>
              </div>
              <div className="queue-list">
                {FIXTURES.map((fx) => {
                  const predicted = locked.has(fx.id);
                  const active = fx.id === selectedId;
                  return (
                    <button
                      key={fx.id}
                      className={`qrow ${active ? 'active' : ''}`}
                      onClick={() => setSelectedId(fx.id)}
                      aria-current={active}
                    >
                      <span className="q-flags" aria-hidden>{fx.home.flag}{fx.away.flag}</span>
                      <span className="q-teams">
                        {fx.home.code} <i>v</i> {fx.away.code}
                        <span className="q-meta">{fx.group} · {fx.city}</span>
                      </span>
                      {fx.status === 'LIVE'
                        ? <span className="q-status q-live">● {fx.liveMinute}′</span>
                        : <span className="q-status q-up">{formatCountdown(kickoffs[fx.id] - now).slice(0, 5)}</span>}
                      {predicted && <span className="q-check" aria-label="Locked">✓</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>
        </main>

        {/* ───────── Footer / broadcast credits ───────── */}
        <footer className="mpc-foot">
          <span>◤ FANTASY HUB · BROADCAST GRAPHICS v1.0 ◥</span>
          <span>HOST CITIES: 16 · TEAMS: 48 · KM TRAVELLED BY GROUP F: 4,310</span>
          <span>FX-FEED · {new Date(now).toUTCString().slice(17, 25)} UTC</span>
        </footer>
      </div>
    </div>
  );
}

/* ===========================================================================
 * Vertical broadcast score stepper (▲ digit ▼)
 * ======================================================================== */

function ScoreColumn(props: {
  value: number;
  editable: boolean;
  label: string;
  onBump: (delta: number) => void;
}): React.ReactElement {
  const { value, editable, label, onBump } = props;
  return (
    <div className="score-col">
      <button
        className="stp up"
        disabled={!editable || value >= 9}
        onClick={() => onBump(1)}
        aria-label={`Increase ${label} score`}
      >
        ▲
      </button>
      <span className="num" key={value}>{value}</span>
      <button
        className="stp down"
        disabled={!editable || value <= 0}
        onClick={() => onBump(-1)}
        aria-label={`Decrease ${label} score`}
      >
        ▼
      </button>
    </div>
  );
}

/* ===========================================================================
 * Styles — injected once. Scoped under .mpc.
 * ======================================================================== */

const CSS = `
.mpc{
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  font-family:'Archivo',system-ui,-apple-system,sans-serif;
  color:var(--ink); background:var(--paper);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  position:relative; min-height:100vh; overflow-x:hidden;
}
.mpc *{ box-sizing:border-box; }
.mpc::before{
  content:''; position:fixed; inset:0; z-index:1; pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity:.05; mix-blend-mode:multiply;
}
.mpc ::selection{ background:var(--signal); color:var(--paper); }
.mpc-shell{ position:relative; z-index:2; max-width:1320px; margin:0 auto; padding:0 clamp(16px,3vw,40px) 60px; }

/* ---- top bar ---- */
.mpc-top{ display:flex; align-items:center; justify-content:space-between; gap:16px;
  border-bottom:3px solid var(--ink); padding:20px 0 14px; flex-wrap:wrap; }
.mpc-brand{ display:flex; align-items:center; gap:13px; }
.mpc-mark{ width:38px; height:38px; background:var(--signal); color:var(--paper);
  display:grid; place-items:center; font-family:'Anton'; font-size:21px;
  transform:skewX(-7deg); box-shadow:4px 4px 0 var(--ink); }
.mpc-word{ font-family:'Anton'; font-size:clamp(20px,3.2vw,30px); line-height:.86;
  letter-spacing:-.5px; text-transform:uppercase; }
.mpc-word small{ display:block; font-family:'Space Mono'; font-weight:700;
  font-size:9px; letter-spacing:2.5px; color:var(--muted); margin-top:4px; }
.mpc-top-right{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.mpc-md{ display:flex; gap:0; }
.mpc-md button{ font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:1px;
  padding:8px 11px; border:2px solid var(--ink); background:var(--paper); color:var(--ink);
  cursor:pointer; text-transform:uppercase; margin-left:-2px; transition:background .12s,color .12s; }
.mpc-md button:first-child{ margin-left:0; }
.mpc-md button:hover{ background:var(--paper-2); }
.mpc-md button.on{ background:var(--ink); color:var(--volt); }
.mpc-points{ font-family:'Anton'; font-size:15px; background:var(--volt); color:var(--ink);
  padding:8px 13px; transform:skewX(-7deg); border:2px solid var(--ink); }
.mpc-points span{ display:inline-block; transform:skewX(7deg); }
.mpc-clock{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:1px;
  color:var(--ink); display:flex; align-items:center; gap:5px; }
.mpc-clock b{ color:var(--muted); }
.mpc-clock b.on{ color:var(--signal); }

/* ---- ticker ---- */
.mpc-ticker{ margin-top:14px; background:var(--ink); color:var(--paper);
  border:2px solid var(--ink); overflow:hidden; }
.mpc-ticker .track{ display:inline-flex; white-space:nowrap; will-change:transform;
  animation:marq 34s linear infinite; padding:9px 0;
  font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:1px; text-transform:uppercase; }
.mpc-ticker .track span{ padding:0 16px; }
.mpc-ticker .hot{ color:var(--volt); }
.mpc-ticker .dot{ color:var(--signal); }

/* ---- stage grid ---- */
.mpc-stage{ display:grid; grid-template-columns:minmax(0,1.65fr) minmax(304px,1fr);
  gap:20px; margin-top:20px; align-items:start; }
.mpc-hero{ animation:wipe .55s both; }
.mpc-rail{ display:flex; flex-direction:column; gap:18px; animation:rise .6s .12s both; }
@media(max-width:980px){ .mpc-stage{ grid-template-columns:1fr; } }

/* ---- scorebug ---- */
.mpc-bug{ position:relative; background:var(--ink-2); color:var(--paper); overflow:hidden;
  border:3px solid var(--ink); box-shadow:11px 11px 0 var(--ink);
  padding:clamp(18px,2.4vw,30px);
  clip-path:polygon(0 0,100% 0,100% calc(100% - 26px),calc(100% - 26px) 100%,0 100%); }
.mpc-bug .blocks{ position:absolute; inset:0; z-index:0; }
.mpc-bug .blk{ position:absolute; top:0; bottom:0; width:64%; opacity:.18; }
.mpc-bug .blk.h{ left:0; background:var(--home); clip-path:polygon(0 0,100% 0,74% 100%,0 100%); }
.mpc-bug .blk.a{ right:0; background:var(--away); clip-path:polygon(26% 0,100% 0,100% 100%,0 100%); }
.mpc-bug .seam{ position:absolute; top:-12%; bottom:-12%; left:50%; width:3px;
  background:var(--volt); transform:skewX(-18deg); opacity:.5; }
.mpc-bug > *:not(.blocks){ position:relative; z-index:2; }

.stamp{ position:absolute; top:16px; right:34px; z-index:6; font-family:'Anton';
  text-transform:uppercase; color:var(--signal); border:3px solid var(--signal);
  padding:5px 11px; transform:rotate(-12deg); letter-spacing:1px; font-size:18px;
  box-shadow:0 0 0 3px rgba(255,58,14,.14); animation:stampin .45s both; }

.bug-strip{ display:flex; justify-content:space-between; align-items:center; gap:10px;
  font-family:'Space Mono'; font-weight:700; font-size:11px; letter-spacing:1.5px;
  text-transform:uppercase; color:rgba(241,236,224,.66); flex-wrap:wrap;
  border-bottom:1px solid rgba(241,236,224,.18); padding-bottom:12px; }
.bug-strip .grp{ color:var(--volt); }
.live-badge{ color:var(--signal); display:inline-flex; align-items:center; gap:6px; }
.live-badge b{ color:var(--signal); }
.live-badge b.on{ opacity:.25; }
.up-badge{ color:var(--volt); }

.bug-match{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center;
  gap:clamp(6px,1.6vw,22px); padding:clamp(14px,2vw,26px) 0; }
.team{ display:flex; flex-direction:column; gap:8px; min-width:0; }
.team.away{ align-items:flex-end; text-align:right; }
.team .flag{ font-size:clamp(32px,5vw,50px); line-height:1; }
.team .code{ font-family:'Anton'; font-size:clamp(28px,5.2vw,56px); line-height:.8;
  letter-spacing:-1px; }
.team .name{ font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:1.5px;
  color:rgba(241,236,224,.6); text-transform:uppercase; }

.bug-score{ display:flex; align-items:center; gap:clamp(4px,1.2vw,14px); }
.score-col{ display:flex; flex-direction:column; align-items:center; gap:7px; }
.score-col .num{ font-family:'Anton'; font-size:clamp(58px,11.5vw,120px); line-height:.7;
  color:var(--paper); font-variant-numeric:tabular-nums; animation:pop .18s; }
.score-dash{ font-family:'Anton'; font-size:clamp(36px,6vw,74px); color:var(--signal);
  transform:translateY(-8px); }
.stp{ width:clamp(34px,4.4vw,46px); height:clamp(24px,3vw,30px); background:transparent;
  border:2px solid rgba(241,236,224,.32); color:var(--paper); font-size:11px;
  cursor:pointer; display:grid; place-items:center;
  transition:transform .12s,background .12s,border-color .12s,color .12s; }
.stp:hover:not(:disabled){ background:var(--volt); color:var(--ink); border-color:var(--volt); }
.stp:active:not(:disabled){ transform:scale(.84); }
.stp:disabled{ opacity:.22; cursor:not-allowed; }

/* Tighten the oversized matchup on small phones so side codes never clip. */
@media(max-width:560px){
  .bug-match{ gap:4px; }
  .team .flag{ font-size:30px; }
  .team .code{ font-size:30px; letter-spacing:-.5px; }
  .team .name{ font-size:9px; word-break:break-word; }
  .score-col .num{ font-size:54px; }
  .score-dash{ font-size:32px; }
  .stp{ width:30px; height:22px; }
}

/* ---- crowd split ---- */
.split{ margin-top:4px; }
.split-head{ display:flex; justify-content:space-between; font-family:'Space Mono';
  font-weight:700; font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
  color:rgba(241,236,224,.55); margin-bottom:8px; }
.split-bar{ display:flex; height:17px; border:1px solid rgba(241,236,224,.28); overflow:hidden; }
.split-seg{ height:100%; transition:width .6s cubic-bezier(.2,.8,.2,1); }
.seg-h{ background:var(--home); }
.seg-d{ background:repeating-linear-gradient(45deg,
  rgba(241,236,224,.42) 0 6px, rgba(241,236,224,.14) 6px 12px); }
.seg-a{ background:var(--away); }
.split-legend{ display:flex; justify-content:space-between; gap:8px; margin-top:9px; }
.split-legend > div{ font-family:'Space Mono'; font-weight:700; font-size:11px;
  letter-spacing:.5px; color:rgba(241,236,224,.78); display:flex; align-items:baseline; gap:4px; }
.split-legend .mid{ justify-content:center; }
.split-legend > div:last-child{ justify-content:flex-end; }
.split-legend .pct{ font-family:'Anton'; font-size:19px; letter-spacing:0; }
.split-legend .pick{ color:var(--volt); }
.split-legend em{ font-style:normal; color:var(--volt); font-size:9px; letter-spacing:1px; }

/* ---- actions ---- */
.bug-actions{ display:flex; align-items:center; gap:13px; margin-top:18px; flex-wrap:wrap;
  border-top:1px solid rgba(241,236,224,.18); padding-top:16px; }
.potential{ font-family:'Space Mono'; font-weight:700; font-size:12px; letter-spacing:1px;
  text-transform:uppercase; color:rgba(241,236,224,.72); }
.potential b{ font-family:'Anton'; color:var(--volt); font-size:21px; letter-spacing:0; }
.risk{ font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:1.5px;
  text-transform:uppercase; padding:5px 9px; border:1.5px solid currentColor; }
.risk-bold{ color:var(--volt); }
.risk-spicy{ color:var(--signal); }
.risk-chalk{ color:rgba(241,236,224,.5); }
.odds{ font-family:'Space Mono'; font-size:11px; letter-spacing:.5px;
  color:rgba(241,236,224,.42); }
.lock-btn{ margin-left:auto; font-family:'Anton'; text-transform:uppercase;
  font-size:clamp(15px,1.9vw,19px); letter-spacing:.5px; background:var(--signal);
  color:var(--paper); border:2px solid var(--paper); padding:12px 22px; cursor:pointer;
  transform:skewX(-7deg); box-shadow:4px 4px 0 var(--volt);
  transition:transform .14s,box-shadow .14s,background .14s; }
.lock-btn span{ display:inline-block; transform:skewX(7deg); }
.lock-btn:hover{ transform:skewX(-7deg) translate(-2px,-2px); box-shadow:7px 7px 0 var(--volt); }
.lock-btn:active{ transform:skewX(-7deg) translate(2px,2px); box-shadow:1px 1px 0 var(--volt); }
.lock-btn.is-locked{ background:transparent; color:var(--volt); border-color:var(--volt);
  box-shadow:4px 4px 0 rgba(214,255,21,.3); }

/* ---- form + h2h ---- */
.mpc-meta{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:18px; }
@media(max-width:560px){ .mpc-meta{ grid-template-columns:1fr; } }
.meta-card{ border:2px solid var(--ink); background:var(--paper); padding:15px 16px; }
.meta-card h4{ font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:2px;
  text-transform:uppercase; color:var(--muted); margin:0 0 13px; }
.form-row{ display:flex; align-items:center; justify-content:space-between; }
.form-row + .form-row{ margin-top:10px; }
.form-row .who{ font-family:'Anton'; font-size:19px; }
.form-chips{ display:flex; gap:4px; }
.chip{ width:22px; height:22px; display:grid; place-items:center;
  font-family:'Space Mono'; font-weight:700; font-size:11px; }
.chip.W{ background:var(--ink); color:var(--volt); }
.chip.D{ background:var(--paper-2); color:var(--ink); border:1px solid var(--line); }
.chip.L{ background:var(--signal); color:var(--paper); }
.h2h{ display:flex; justify-content:space-between; text-align:center; }
.h2h > div{ font-family:'Anton'; font-size:clamp(24px,3.4vw,30px); line-height:1; flex:1; }
.h2h small{ display:block; font-family:'Space Mono'; font-weight:700; font-size:8px;
  letter-spacing:1.5px; color:var(--muted); margin-top:6px; }

/* ---- slip ---- */
.slip{ border:3px solid var(--ink); background:var(--ink); color:var(--paper);
  box-shadow:9px 9px 0 var(--signal); }
.slip-head{ display:flex; justify-content:space-between; align-items:center;
  padding:14px 16px; border-bottom:2px solid rgba(241,236,224,.2); }
.slip-head h3{ font-family:'Anton'; font-size:21px; text-transform:uppercase; margin:0; }
.slip-head .tag{ font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:1.5px;
  color:var(--volt); }
.slip-stats{ display:grid; grid-template-columns:repeat(3,1fr); }
.slip-stat{ padding:15px 12px; border-right:1px solid rgba(241,236,224,.15); }
.slip-stat:last-child{ border-right:none; }
.slip-stat .v{ font-family:'Anton'; font-size:clamp(24px,3.2vw,31px); line-height:1; color:var(--volt); }
.slip-stat .k{ font-family:'Space Mono'; font-weight:700; font-size:8px; letter-spacing:1px;
  color:rgba(241,236,224,.6); text-transform:uppercase; margin-top:7px; }
.slip-list{ max-height:210px; overflow:auto; }
.slip-item{ width:100%; text-align:left; background:transparent; border:none;
  border-bottom:1px dashed rgba(241,236,224,.14); padding:11px 16px; cursor:pointer;
  display:flex; justify-content:space-between; align-items:center; gap:8px;
  font-family:'Space Mono'; font-weight:700; font-size:12px; color:var(--paper);
  transition:background .14s; }
.slip-item:hover{ background:rgba(241,236,224,.06); }
.slip-item .res{ font-family:'Anton'; font-size:16px; color:var(--paper); margin:0 2px; }
.slip-item .pts{ color:var(--volt); }
.slip-empty{ padding:18px 16px; font-family:'Space Mono'; font-size:11px; letter-spacing:.5px;
  color:rgba(241,236,224,.5); text-transform:uppercase; }

/* ---- queue ---- */
.queue{ border:3px solid var(--ink); background:var(--paper); }
.queue-head{ display:flex; justify-content:space-between; align-items:center;
  padding:13px 14px; border-bottom:2px solid var(--ink); background:var(--paper-2); }
.queue-head h3{ font-family:'Anton'; font-size:19px; text-transform:uppercase; margin:0; }
.queue-meta{ font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:1px; color:var(--muted); }
.queue-list{ max-height:430px; overflow:auto; }
.qrow{ width:100%; text-align:left; background:transparent; border:none;
  border-bottom:1px solid var(--line); padding:12px 14px 12px 18px; cursor:pointer;
  display:flex; align-items:center; gap:11px; position:relative; transition:background .14s; }
.qrow:hover{ background:var(--paper-2); }
.qrow.active{ background:var(--ink); color:var(--paper); }
.qrow.active::before{ content:''; position:absolute; left:0; top:0; bottom:0; width:6px; background:var(--signal); }
.qrow .q-flags{ font-size:17px; line-height:1; }
.qrow .q-teams{ font-family:'Anton'; font-size:18px; letter-spacing:-.3px; line-height:1;
  flex:1; display:flex; flex-direction:column; gap:4px; }
.qrow .q-teams i{ font-style:normal; color:var(--signal); }
.qrow.active .q-teams i{ color:var(--volt); }
.qrow .q-meta{ font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:.8px;
  color:var(--muted); text-transform:uppercase; }
.qrow.active .q-meta{ color:rgba(241,236,224,.6); }
.q-status{ font-family:'Space Mono'; font-weight:700; font-size:9px; letter-spacing:.5px;
  padding:3px 6px; text-transform:uppercase; white-space:nowrap; }
.q-live{ background:var(--signal); color:var(--paper); }
.q-up{ border:1px solid var(--line); color:var(--muted); }
.qrow.active .q-up{ border-color:rgba(241,236,224,.3); color:rgba(241,236,224,.7); }
.q-check{ width:20px; height:20px; flex:none; background:var(--volt); color:var(--ink);
  display:grid; place-items:center; font-size:11px; font-weight:900; }

/* ---- footer ---- */
.mpc-foot{ margin-top:34px; border-top:3px solid var(--ink); padding-top:14px;
  display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap;
  font-family:'Space Mono'; font-weight:700; font-size:10px; letter-spacing:1px;
  color:var(--muted); text-transform:uppercase; }

/* ---- scrollbars ---- */
.queue-list::-webkit-scrollbar, .slip-list::-webkit-scrollbar{ width:8px; }
.queue-list::-webkit-scrollbar-track{ background:var(--paper-2); }
.queue-list::-webkit-scrollbar-thumb{ background:var(--ink); }
.slip-list::-webkit-scrollbar-track{ background:rgba(241,236,224,.08); }
.slip-list::-webkit-scrollbar-thumb{ background:var(--signal); }

/* ---- keyframes ---- */
@keyframes marq{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
@keyframes wipe{ from{ opacity:0; transform:translateY(-12px); } to{ opacity:1; transform:none; } }
@keyframes rise{ from{ opacity:0; transform:translateY(16px); } to{ opacity:1; transform:none; } }
@keyframes pop{ from{ transform:scale(.66); opacity:.2; } to{ transform:scale(1); opacity:1; } }
@keyframes stampin{ 0%{ transform:rotate(-12deg) scale(1.7); opacity:0; }
  60%{ opacity:1; } 100%{ transform:rotate(-12deg) scale(1); opacity:1; } }

@media (prefers-reduced-motion: reduce){
  .mpc *, .mpc *::before, .mpc *::after{ animation:none !important; transition:none !important; }
}
`;
