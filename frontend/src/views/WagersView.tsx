/**
 * WagersView.tsx
 * ----------------------------------------------------------------------------
 * The public boast marketplace (CONTRACT §7.2/§7.4), in three lenses:
 *   - market  — PENDING wagers on still-unlocked matches; anyone but the
 *               creator can take the other side (AcceptWagerModal requires a
 *               typed forfeit, confirmed with "seal it");
 *   - mine    — every wager I created or accepted, with jewel state chips;
 *               my PENDING boasts can be withdrawn, lapsed ones read
 *               "expired, unclaimed";
 *   - settled — the ledger: "@loser owes @winner: <forfeit>".
 *
 * One GET /api/wagers powers all three lenses (the API returns newest first);
 * unlocked matches for the composer come from GET /api/matches. Both refetch
 * after every mutation.
 * ----------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import AcceptWagerModal from '../components/AcceptWagerModal';
import EmptyState, { ErrorCard, LoadingCard } from '../components/EmptyState';
import WagerCard from '../components/WagerCard';
import WagerComposerModal from '../components/WagerComposerModal';
import { isLocked } from '../lib/datetime';
import { useAuth } from '../state/AuthContext';
import type { MatchWithMine, WagerView } from '../types/models';

/** The three market lenses. */
type TabKey = 'market' | 'mine' | 'settled';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'market', label: 'market' },
  { key: 'mine', label: 'mine' },
  { key: 'settled', label: 'settled' },
];

export default function WagersView(): JSX.Element {
  const { user } = useAuth();
  const meId = user?.id ?? '';

  const [tab, setTab] = useState<TabKey>('market');
  const [wagers, setWagers] = useState<WagerView[] | null>(null);
  const [matches, setMatches] = useState<MatchWithMine[] | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [accepting, setAccepting] = useState<WagerView | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [allWagers, allMatches] = await Promise.all([api.listWagers(), api.listMatches()]);
      setWagers(allWagers);
      setMatches(allMatches);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw(w: WagerView): Promise<void> {
    try {
      await api.deleteWager(w.id);
    } catch {
      // The server guards PENDING-only / creator-only; the reload tells truth.
    }
    void load();
  }

  const loaded = wagers !== null && matches !== null;
  if (failed && !loaded) return <ErrorCard onRetry={() => void load()} />;
  if (!loaded) return <LoadingCard />;

  // Derive the three lenses from the single wager list.
  const now = new Date();
  const market = wagers.filter((w) => w.state === 'PENDING' && !isLocked(w, now));
  const mine = wagers.filter((w) => w.creator_id === meId || w.acceptor_id === meId);
  const settled = wagers.filter(
    (w) => w.state === 'RESOLVED_WON' || w.state === 'RESOLVED_LOST',
  );
  const active = tab === 'market' ? market : tab === 'mine' ? mine : settled;

  // The composer only offers matches that are still open for business.
  const openMatches = matches.filter((m) => !isLocked(m, now));

  const emptyCopy: Record<TabKey, string> = {
    market: 'the market is quiet. someone say something confident.',
    mine: 'you haven’t put anything on the line yet.',
    settled: 'no debts on the books. the season is young.',
  };

  return (
    <div>
      <span className="kicker">public boasts</span>
      <h1 className="view-title">the market</h1>

      <div className="row-between">
        <div className="filters" role="group" aria-label="wager lens">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip chip--small${tab === t.key ? ' on' : ''}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--small" onClick={() => setComposerOpen(true)}>
          say something confident
        </button>
      </div>

      <div className="section stack">
        {active.length === 0 ? (
          <EmptyState message={emptyCopy[tab]} />
        ) : (
          active.map((w) => (
            <WagerCard
              key={w.id}
              wager={w}
              meId={meId}
              onAccept={tab !== 'settled' ? (x) => setAccepting(x) : undefined}
              onWithdraw={tab !== 'settled' ? (x) => void withdraw(x) : undefined}
            />
          ))
        )}
      </div>

      {composerOpen && (
        <WagerComposerModal
          matches={openMatches}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            void load();
          }}
        />
      )}

      {accepting && (
        <AcceptWagerModal
          wager={accepting}
          onClose={() => setAccepting(null)}
          onAccepted={() => {
            setAccepting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
