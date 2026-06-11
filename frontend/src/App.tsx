/**
 * App.tsx
 * ----------------------------------------------------------------------------
 * Root shell for The Almanac Cup (CONTRACT §7.2):
 *
 *   <AuthProvider>
 *     booting?          → quiet "checking the post…" card
 *     unauthenticated?  → <LoginView/>
 *     authenticated?    → <BrowserRouter> + routes + bottom tab bar
 *
 * Routes: /hub · /matches · /bracket · /table · /wagers (+ /admin, tab and
 * route both gated on user.is_admin). Default and unknown paths → /hub.
 *
 * Theme: `data-theme` on <html>; default follows prefers-color-scheme; the
 * header toggle persists the choice as localStorage 'almanac_theme'.
 * Fonts (Fraunces + Hanken Grotesk) load once on mount via the idempotent
 * loader in lib/fonts.ts.
 * ----------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { loadFonts } from './lib/fonts';
import { AuthProvider, useAuth } from './state/AuthContext';
import { LoadingCard } from './components/EmptyState';
import LoginView from './views/LoginView';
import HubView from './views/HubView';
import MatchesView from './views/MatchesView';
import BracketView from './views/BracketView';
import LeaderboardView from './views/LeaderboardView';
import WagersView from './views/WagersView';
import AdminView from './views/AdminView';

/* ===========================================================================
 * Theme handling — data-theme on <html>, persisted as 'almanac_theme'.
 * ======================================================================== */

type Theme = 'light' | 'dark';

/** The fixed localStorage key for the persisted theme (CONTRACT §7.1). */
const THEME_KEY = 'almanac_theme';

/** Stored choice wins; otherwise defer to the OS via prefers-color-scheme. */
function readInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* ===========================================================================
 * Bottom tab bar
 * ======================================================================== */

/** Active tab = ink-filled "pressed on" pill (almanac.css .tab.on). */
function tabClass({ isActive }: { isActive: boolean }): string {
  return `tab${isActive ? ' on' : ''}`;
}

/* ===========================================================================
 * Shell — header + auth gate + routes. Lives INSIDE AuthProvider.
 * ======================================================================== */

interface ShellProps {
  theme: Theme;
  onToggleTheme: () => void;
}

function Shell({ theme, onToggleTheme }: ShellProps): JSX.Element {
  const { user, booting, logout } = useAuth();

  // The shared paper header: wordmark kicker + theme toggle (+ sign out).
  const header = (
    <header className="apphead">
      <span className="kicker">world cup 2026</span>
      <div className="apphead-actions">
        <button
          type="button"
          className="iconbtn"
          aria-label={theme === 'light' ? 'switch to dark theme' : 'switch to light theme'}
          onClick={onToggleTheme}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
        {user && (
          <button type="button" className="iconbtn" onClick={logout}>
            sign out
          </button>
        )}
      </div>
    </header>
  );

  // Boot re-validation still in flight — keep the paper calm.
  if (booting) {
    return (
      <div className="wrap">
        {header}
        <LoadingCard />
      </div>
    );
  }

  // No session → the front door.
  if (!user) {
    return (
      <div className="wrap">
        {header}
        <LoginView />
      </div>
    );
  }

  // Signed in → the routed app with the thumb-reachable bottom tab bar.
  return (
    <BrowserRouter>
      <div className="wrap app-main">
        {header}
        <Routes>
          <Route path="/" element={<Navigate to="/hub" replace />} />
          <Route path="/hub" element={<HubView />} />
          <Route path="/matches" element={<MatchesView />} />
          <Route path="/bracket" element={<BracketView />} />
          <Route path="/table" element={<LeaderboardView />} />
          <Route path="/wagers" element={<WagersView />} />
          {/* Admin: route guard AND hidden tab — both keyed on is_admin. */}
          <Route
            path="/admin"
            element={user.is_admin ? <AdminView /> : <Navigate to="/hub" replace />}
          />
          <Route path="*" element={<Navigate to="/hub" replace />} />
        </Routes>
      </div>

      <nav className="tabbar" aria-label="primary">
        <NavLink to="/hub" className={tabClass}>
          Hub
        </NavLink>
        <NavLink to="/matches" className={tabClass}>
          Matches
        </NavLink>
        <NavLink to="/bracket" className={tabClass}>
          Bracket
        </NavLink>
        <NavLink to="/table" className={tabClass}>
          Table
        </NavLink>
        <NavLink to="/wagers" className={tabClass}>
          Wagers
        </NavLink>
        {user.is_admin && (
          <NavLink to="/admin" className={tabClass}>
            Admin
          </NavLink>
        )}
      </nav>
    </BrowserRouter>
  );
}

/* ===========================================================================
 * App root
 * ======================================================================== */

export default function App(): JSX.Element {
  // Load Fraunces + Hanken Grotesk once for the whole app.
  useEffect(() => {
    loadFonts();
  }, []);

  // Theme state: initialised from storage / OS, mirrored onto <html> and
  // persisted on every change.
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <AuthProvider>
      <Shell
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />
    </AuthProvider>
  );
}
