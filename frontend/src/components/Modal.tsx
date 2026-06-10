/**
 * Modal.tsx
 * ----------------------------------------------------------------------------
 * Accessible Warm Almanac dialog (CONTRACT §7.1 accessibility rules):
 *   - role="dialog" + aria-modal="true";
 *   - closes on Escape AND on backdrop click (clicks inside the panel do not
 *     bubble out to the backdrop handler);
 *   - the panel receives focus on mount so keyboard users land inside;
 *   - the paper-card chrome (1.5px ink border, 6px hard shadow) comes from
 *     .card + .modal-panel in styles/almanac.css.
 * ----------------------------------------------------------------------------
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  /** Dialog heading — doubles as the accessible name (aria-label). */
  title: string;
  /** Invoked on Escape, backdrop click, or the × button. */
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, onClose, children }: ModalProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Escape closes the dialog from anywhere in the document.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Land keyboard focus inside the dialog on mount.
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // Only a press on the backdrop itself dismisses — not panel content.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="card modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="iconbtn" aria-label="close dialog" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
