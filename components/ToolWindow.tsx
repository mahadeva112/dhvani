import React from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { PageScrollLock } from './usePageScrollLock';
import { clearOpenedFromTools, openedFromTools, reopenTools } from './toolsReturn';

/**
 * The one look every tool and settings window shares: opened in the middle of
 * the screen over a dimmed page, a small tinted icon with the name and a line
 * under it at the top, a round close button, the window's own content, and a
 * footer bar with the window's last word (Done, Save) on the right.
 *
 * The window is on screen for as long as it is mounted; a click on the dimmed
 * page closes it. Escape stays the window's own, since some use it for their
 * own popovers first. Opened from Tools and settings, it also has a Back
 * button that closes it and opens the list again.
 */

export type ToolWindowTone = 'indigo' | 'teal' | 'pink' | 'amber' | 'slate' | 'blue' | 'violet' | 'emerald';

const TILE: Record<ToolWindowTone, string> = {
  indigo: 'bg-indigo-500/15 text-indigo-300',
  teal: 'bg-teal-500/15 text-teal-300',
  pink: 'bg-pink-500/15 text-pink-300',
  amber: 'bg-amber-500/15 text-amber-300',
  slate: 'bg-slate-400/15 text-slate-300',
  blue: 'bg-blue-500/15 text-blue-300',
  violet: 'bg-violet-500/15 text-violet-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
};

/** The main button at the foot of a tool window. */
export const toolPrimaryButton =
  'h-9 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors cursor-default disabled:opacity-50 disabled:pointer-events-none';
/** A plain bordered button at the foot of a tool window. */
export const toolSecondaryButton =
  'h-9 px-3.5 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 transition-colors cursor-default disabled:opacity-50 disabled:pointer-events-none';
/** A text-only button at the foot of a tool window, such as Reset. */
export const toolTextButton =
  'h-9 px-1 inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-100 transition-colors cursor-default disabled:opacity-40 disabled:pointer-events-none';

export const ToolWindow: React.FC<{
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: ToolWindowTone;
  /** Width of the window, for example max-w-[38rem]. */
  widthClassName: string;
  /** A set height for windows whose content changes size (tabs, steps), so the window does not jump. */
  heightClassName?: string;
  /** Controls in the header between the name and the close button. */
  headerExtra?: React.ReactNode;
  /** The footer bar's content; left out, the window has no footer. */
  footer?: React.ReactNode;
  /** Stacking layer. */
  layerClassName?: string;
  /** The close button and a click on the dimmed page do nothing while true. */
  closeDisabled?: boolean;
  /** False for a window holding unsaved edits: a click on the dimmed page leaves it open. */
  closeOnBackdrop?: boolean;
  /** False for a window that closes by itself, such as one installing an update: no close button. */
  showClose?: boolean;
  /** id for the title, for aria-labelledby. */
  titleId?: string;
  /** The body scrolls by itself unless the window lays out its own scrolling parts. */
  bodyScrolls?: boolean;
  bodyClassName?: string;
  role?: 'dialog' | 'alertdialog';
  children: React.ReactNode;
}> = ({
  onClose,
  title,
  subtitle,
  icon: Icon,
  tone,
  widthClassName,
  heightClassName = '',
  headerExtra,
  footer,
  layerClassName = 'z-50',
  closeDisabled = false,
  showClose = true,
  closeOnBackdrop = true,
  titleId,
  bodyScrolls = true,
  bodyClassName = '',
  role = 'dialog',
  children,
}) => {
  // Opened from Tools and settings: Back closes this window and brings the list back.
  const [fromTools] = React.useState(openedFromTools);
  React.useEffect(() => clearOpenedFromTools(), []);
  const canGoBack = fromTools && showClose;
  const goBack = React.useCallback(() => {
    if (closeDisabled) return;
    onClose();
    reopenTools();
  }, [closeDisabled, onClose]);

  return (
  <div
    className={`fixed inset-0 ${layerClassName} flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm tools-hub-veil-in`}
    onMouseDown={(e) => e.target === e.currentTarget && closeOnBackdrop && !closeDisabled && onClose()}
  >
    <PageScrollLock />
    <section
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : typeof title === 'string' ? title : undefined}
      className={`relative w-full ${widthClassName} ${heightClassName} max-h-full flex flex-col rounded-[20px] bg-slate-900/95 border border-slate-700/80 shadow-2xl shadow-black/60 text-slate-100 overflow-hidden tools-hub-panel-in`}
    >
      <header className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3 border-b border-edge flex-wrap">
        {canGoBack && (
          <>
            <button
              type="button"
              onClick={goBack}
              disabled={closeDisabled}
              title="Back to Tools and settings"
              aria-label="Back to Tools and settings"
              className="group shrink-0 h-8 pl-1 pr-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-slate-700/60 to-slate-800/80 ring-1 ring-inset ring-white/10 shadow-md shadow-black/40 text-[12.5px] font-medium text-slate-200 hover:from-indigo-500/40 hover:to-indigo-600/30 hover:ring-indigo-300/30 hover:text-white transition-all duration-150 cursor-default disabled:opacity-40 disabled:pointer-events-none"
            >
              <span className="w-6 h-6 rounded-full bg-white/10 ring-1 ring-inset ring-white/10 flex items-center justify-center transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:bg-white/15">
                <ChevronLeft className="w-3.5 h-3.5" />
              </span>
              Tools
            </button>
            <span className="w-px h-6 shrink-0 bg-slate-700/80" aria-hidden="true" />
          </>
        )}
        <span className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${TILE[tone]}`} aria-hidden="true">
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <span className="min-w-[10rem] flex-1">
          <h2 id={titleId} className="text-[15px] font-semibold text-slate-100 leading-tight truncate">
            {title}
          </h2>
          {subtitle && <p className="text-[12px] text-slate-400 mt-0.5">{subtitle}</p>}
        </span>
        {headerExtra}
        {showClose && (
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
          className="w-8 h-8 shrink-0 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center transition-colors cursor-default disabled:opacity-40 disabled:pointer-events-none"
        >
          <X className="w-4 h-4" />
        </button>
        )}
      </header>
      <div className={`flex-1 min-h-0 ${bodyScrolls ? 'overflow-y-auto overscroll-contain [scrollbar-width:thin]' : 'flex flex-col overflow-hidden'} ${bodyClassName}`}>
        {children}
      </div>
      {footer && <footer className="shrink-0 flex items-center gap-3 px-5 py-3 border-t border-edge flex-wrap">{footer}</footer>}
    </section>
  </div>
  );
};
