/**
 * EmptyState.tsx
 * ----------------------------------------------------------------------------
 * The three "quiet card" primitives every view leans on (CONTRACT §7.4):
 *
 *   - <EmptyState message=… />  a calm, witty empty card (canned copy lives
 *     at the call sites: "no fixtures yet. the ingest checks in soon." etc.);
 *   - <LoadingCard />           the loading hint — "checking the post…";
 *   - <ErrorCard onRetry=… />   the error card with a retry button —
 *     "the wire is down. try again."
 * ----------------------------------------------------------------------------
 */

/** A calm paper card carrying one line of lowercase small print. */
export default function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="card empty-card">
      <p className="hint">{message}</p>
    </div>
  );
}

/** The canonical loading state, shown while a view's first fetch is out. */
export function LoadingCard(): JSX.Element {
  return (
    <div className="card empty-card" aria-busy="true">
      <p className="hint">checking the post…</p>
    </div>
  );
}

/** The canonical error state: the canned line plus a retry button. */
export function ErrorCard({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="card empty-card" role="alert">
      <p className="hint">the wire is down. try again.</p>
      <button type="button" className="btn btn--small" onClick={onRetry}>
        retry
      </button>
    </div>
  );
}
