import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CLOSE_MS = 150;

/**
 * A header window opened in the middle of the screen over a dimmed page, the
 * same way Tools and settings opens. A click on the dimmed page or Escape
 * closes it. Opening and closing are the Tools hub's short fade and zoom.
 */
export const CenteredPanel: React.FC<{
  open: boolean;
  onClose: () => void;
  label: string;
  /** Width and padding of the window itself. */
  className?: string;
  children: React.ReactNode;
}> = ({ open, onClose, label, className = '', children }) => {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);

  // Stays on screen while it plays its closing animation.
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!shown) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm ${
        closing ? 'tools-hub-veil-out' : 'tools-hub-veil-in'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`relative w-full max-h-full overflow-y-auto rounded-[20px] bg-slate-900/95 border border-slate-700/80 shadow-2xl shadow-black/60 text-slate-100 flex flex-col ${
          closing ? 'tools-hub-panel-out' : 'tools-hub-panel-in'
        } ${className}`}
      >
        {children}
      </section>
    </div>,
    document.body
  );
};
