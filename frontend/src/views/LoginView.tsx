/**
 * LoginView.tsx
 * ----------------------------------------------------------------------------
 * The front door (CONTRACT §7.2): a hero card with the gold kicker
 * 'the almanac · wc 2026', the big Fraunces .title, a username input and the
 * passwordless login button. Username rule mirrors the server:
 * ^[A-Za-z0-9_ ]{2,20}$ (trimmed). Logging in upserts the user — the canned
 * small print says it all: "no passwords. just don't pick your friend's name."
 * ----------------------------------------------------------------------------
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';

/** Client-side mirror of the server's username validation (§6). */
const USERNAME_RE = /^[A-Za-z0-9_ ]{2,20}$/;

export default function LoginView(): JSX.Element {
  const { login } = useAuth();
  const [username, setUsername] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = username.trim();
  const valid = USERNAME_RE.test(trimmed);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    if (!valid) {
      setErr('2–20 characters: letters, numbers, spaces or underscores.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await login(trimmed);
      // Success: AuthContext flips `user`, and the shell swaps to the app.
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'the wire is down. try again.');
      setBusy(false);
    }
  }

  return (
    <div className="login-hero">
      <span className="kicker">the almanac · wc 2026</span>
      <h1 className="title">the almanac cup</h1>
      <p className="sub">
        forty-eight teams, one season ledger. call every score, post your boasts, and let the
        table keep the receipts.
      </p>

      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label className="field-label" htmlFor="login-username">
            your name in the ledger
          </label>
          <input
            id="login-username"
            className="input"
            type="text"
            autoComplete="username"
            autoFocus
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. tom"
          />
        </div>

        {err && <p className="form-error">{err}</p>}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'checking the post…' : 'step in'}
        </button>
        <p className="hint">no passwords. just don&rsquo;t pick your friend&rsquo;s name.</p>
      </form>
    </div>
  );
}
