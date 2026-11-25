import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { Alert, Button, Field, Textarea } from './ui';
import { lockScroll } from '../lib/scrollLock';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  /** Shows an optional comment box (used by every reject action). */
  commentLabel?: string;
  commentPlaceholder?: string;
  /** The comment must be filled in (at least 5 characters), e.g. a void reason. */
  commentRequired?: boolean;
  /** Extra form fields rendered above the comment box. */
  children?: ReactNode;
  confirmDisabled?: boolean;
  /** Resolve to close; throw to show the error inside the dialog. */
  onConfirm: (comment: string) => Promise<unknown> | unknown;
  onClose: () => void;
}

/** Every action in the app goes through this confirmation step. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  commentLabel,
  commentPlaceholder,
  commentRequired,
  children,
  confirmDisabled,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const commentId = useId();

  useEffect(() => {
    if (!open) return;
    setComment('');
    setError(null);
    setBusy(false);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    // focus the first field, or the cancel button
    requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>('select, textarea, input, [data-autofocus]');
      target?.focus();
    });
    return () => {
      unlock();
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(comment.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !busy && onClose()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        {description && <div className="mb-4 text-sm text-slate-600">{description}</div>}
        <div className="space-y-4">
          {children}
          {commentLabel && (
            <Field label={commentLabel} htmlFor={commentId} optional={!commentRequired}>
              <Textarea
                id={commentId}
                rows={3}
                maxLength={500}
                value={comment}
                placeholder={commentPlaceholder}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={confirm} loading={busy} disabled={confirmDisabled || (commentRequired && comment.trim().length < 5)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
