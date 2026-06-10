/**
 * AuthContext.tsx
 * ----------------------------------------------------------------------------
 * Session state for the passwordless username auth (CONTRACT §6 / §7.2).
 *
 *   - The JWT lives in localStorage under 'almanac_token' (api/client.ts owns
 *     the key; this provider only orchestrates it).
 *   - On boot, an existing token is RE-VALIDATED against GET /api/auth/me:
 *       · 200 → hydrate the User and go straight to the app;
 *       · 401 → the token is stale/forged — drop it and show the login card;
 *       · transport failure → keep the token (the server may just be napping)
 *         but show the login card; a fresh login simply overwrites it.
 *   - `login()` performs the upsert-by-username POST and persists the token.
 *   - `logout()` clears both the token and the in-memory user.
 * ----------------------------------------------------------------------------
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, clearToken, getToken, setToken } from '../api/client';
import type { User } from '../types/models';

/** Everything a consumer can do with the session. */
interface AuthContextValue {
  /** The signed-in user, or null when unauthenticated. */
  user: User | null;
  /** True while the boot re-validation round-trip is still in flight. */
  booting: boolean;
  /** Passwordless login: upsert by username, persist the token, hydrate. */
  login: (username: string, displayName?: string) => Promise<void>;
  /** Drop the token and the in-memory user. */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Wraps the app shell; owns the single source of session truth. */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState<boolean>(true);

  // Boot re-validation: one GET /api/auth/me when a token is already stored.
  useEffect(() => {
    let cancelled = false;

    async function revalidate(): Promise<void> {
      if (!getToken()) {
        // No stored session — straight to the login card, no network call.
        if (!cancelled) setBooting(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch (err) {
        // 401 UNAUTHENTICATED → the token is dead; drop it (CONTRACT §7.2).
        // Anything else (e.g. the wire is down) keeps the token for later.
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void revalidate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, displayName?: string): Promise<void> => {
    const { token, user: me } = await api.login(username, displayName);
    setToken(token);
    setUser(me);
  }, []);

  const logout = useCallback((): void => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, booting, login, logout }),
    [user, booting, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Session accessor — must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
