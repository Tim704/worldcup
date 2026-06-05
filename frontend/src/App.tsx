/**
 * App.tsx
 * ----------------------------------------------------------------------------
 * Root application shell for the World Cup 2026 Fantasy Hub (mobile-first SPA).
 *
 * Composition (CONTRACT §7):
 *   - <BrowserRouter> wraps the four routed views.
 *   - A sticky, thumb-reachable **bottom tab bar** with four destinations:
 *       Hub · Predict · Bloodline · Shame
 *     Each tab label is set in Anton caps; the active tab is painted in the
 *     vermillion --signal accent of the shared "Broadcast Editorial" palette.
 *   - The three display fonts are loaded once on mount via loadFonts().
 *
 * Styling is self-contained: a single <style> block scoped under the `.wc-app`
 * root class, mirroring the pattern used by MatchPredictionCenter. No external
 * CSS framework. All spacing is in px/rem (documented as metric); the bottom
 * bar reserves space for the iOS home-indicator safe area.
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import { useEffect } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { loadFonts } from './lib/fonts';
import Dashboard from './views/Dashboard';
import PredictView from './views/PredictView';
import BloodlineView from './views/BloodlineView';
import HallOfShame from './views/HallOfShame';

/* ===========================================================================
 * Tab bar definition
 * ======================================================================== */

/** One bottom-tab destination. `glyph` is a decorative, aria-hidden marker. */
interface TabDef {
  to: string;
  label: string;
  glyph: string;
}

/** The four routed destinations, left → right (§7). */
const TABS: TabDef[] = [
  { to: '/hub', label: 'Hub', glyph: '◧' },
  { to: '/predict', label: 'Predict', glyph: '◈' },
  { to: '/bloodline', label: 'Bloodline', glyph: '⚔' },
  { to: '/shame', label: 'Shame', glyph: '☠' },
];

/* ===========================================================================
 * Component
 * ======================================================================== */

export default function App(): React.ReactElement {
  // Load the Anton / Archivo / Space Mono families once for the whole app.
  useEffect(() => {
    loadFonts();
  }, []);

  return (
    <BrowserRouter>
      <div className="wc-app">
        <style>{CSS}</style>

        {/* Routed view region. Bottom padding clears the fixed tab bar. */}
        <main className="wc-main">
          <Routes>
            {/* Default route → the Hub dashboard. */}
            <Route path="/" element={<Navigate to="/hub" replace />} />
            <Route path="/hub" element={<Dashboard />} />
            <Route path="/predict" element={<PredictView />} />
            <Route path="/bloodline" element={<BloodlineView />} />
            <Route path="/shame" element={<HallOfShame />} />
            {/* Unknown paths fall back to the Hub. */}
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Routes>
        </main>

        {/* ───────── Sticky bottom tab bar (thumb-reachable) ───────── */}
        <nav className="wc-tabs" aria-label="Primary">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => `wc-tab${isActive ? ' is-active' : ''}`}
            >
              <span className="wc-tab-glyph" aria-hidden>
                {tab.glyph}
              </span>
              <span className="wc-tab-label">{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </BrowserRouter>
  );
}

/* ===========================================================================
 * Styles — injected once, scoped under .wc-app (Broadcast Editorial tokens).
 * ======================================================================== */

const CSS = `
.wc-app{
  /* Shared "Broadcast Editorial" palette (CONTRACT §7). */
  --paper:#f1ece0; --paper-2:#e6dfce; --ink:#0d0d0b; --ink-2:#17170f;
  --signal:#ff3a0e; --volt:#d6ff15; --muted:#7a7060; --line:rgba(13,13,11,.16);
  /* Height (px) reserved for the fixed bottom bar; reused as content padding. */
  --tabbar-h:64px;
  font-family:'Archivo',system-ui,-apple-system,sans-serif;
  color:var(--ink); background:var(--paper);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  min-height:100vh; min-height:100dvh; position:relative; overflow-x:hidden;
}
.wc-app *{ box-sizing:border-box; }
.wc-app ::selection{ background:var(--signal); color:var(--paper); }

/* The routed region: pad the bottom so content never hides under the tab bar
   (bar height + the device safe-area inset). */
.wc-main{
  padding-bottom:calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  min-height:100vh; min-height:100dvh;
}

/* ---- bottom tab bar ---- */
.wc-tabs{
  position:fixed; left:0; right:0; bottom:0; z-index:50;
  display:grid; grid-template-columns:repeat(4,1fr);
  height:var(--tabbar-h);
  background:var(--ink); border-top:3px solid var(--signal);
  /* Extend the tinted bar into the home-indicator safe area on phones. */
  padding-bottom:env(safe-area-inset-bottom, 0px);
  box-shadow:0 -6px 0 rgba(13,13,11,.18);
}
.wc-tab{
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:3px; text-decoration:none; color:rgba(241,236,224,.62);
  border-right:1px solid rgba(241,236,224,.12);
  -webkit-tap-highlight-color:transparent; transition:color .14s,background .14s;
}
.wc-tab:last-child{ border-right:none; }
.wc-tab:hover{ background:rgba(241,236,224,.05); }
.wc-tab-glyph{ font-size:18px; line-height:1; }
.wc-tab-label{
  font-family:'Anton'; text-transform:uppercase; font-size:13px;
  letter-spacing:.6px; line-height:1;
}
/* Active tab — vermillion signal, with a top accent bar for scannability. */
.wc-tab.is-active{ color:var(--signal); position:relative; }
.wc-tab.is-active::before{
  content:''; position:absolute; top:0; left:18%; right:18%; height:4px;
  background:var(--signal);
}
.wc-tab.is-active .wc-tab-glyph{ color:var(--volt); }

@media (prefers-reduced-motion: reduce){
  .wc-app *, .wc-app *::before, .wc-app *::after{
    animation:none !important; transition:none !important;
  }
}
`;
