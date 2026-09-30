import { useCallback, useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import type { Paper } from '@fractal/shared';
import { t } from '../i18n';
import { paperTitle } from '../shell/paper-format';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hidden);
}

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** A modal question with one action and a way out; focus stays inside until it closes. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focusableElements(dialog)[0] ?? dialog).focus();
    return () => {
      if (previous !== null && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const elements = focusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return (
    <div className="dialog-scrim" role="presentation">
      <div ref={dialogRef} className="confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="confirm__title">
          {title}
        </h2>
        <div className="confirm__body">{children}</div>
        <div className="confirm__actions">
          <button type="button" className="text-link text-link--quiet" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          <button type="button" className={danger ? 'button button--danger' : 'button'} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ReplacementRequest {
  modelId: string;
  oldTranslationExists: boolean;
}

export function ReplacementDialog({
  paper,
  replacement,
  canTranslate,
  onConfirm,
  onCancel,
}: {
  paper: Paper | null;
  replacement: ReplacementRequest;
  canTranslate: boolean;
  onConfirm(): void;
  onCancel(): void;
}): JSX.Element {
  return (
    <ConfirmDialog
      title={t('dialog.retranslateTitle')}
      confirmLabel={t('dialog.retranslateConfirm')}
      confirmDisabled={!canTranslate || replacement.modelId.trim().length === 0}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="confirm__subject">{paper === null ? '' : paperTitle(paper)}</p>
      <p>
        {replacement.oldTranslationExists
          ? t('dialog.retranslateReplaces', { model: replacement.modelId })
          : t('dialog.retranslateNew', { model: replacement.modelId })}
      </p>
    </ConfirmDialog>
  );
}

export function DeleteDialog({
  paper,
  paperKey,
  onCancel,
  onConfirm,
}: {
  paper: Paper | undefined;
  paperKey: string;
  onCancel(): void;
  onConfirm(): void;
}): JSX.Element {
  return (
    <ConfirmDialog title={t('dialog.deleteTitle')} confirmLabel={t('dialog.deleteConfirm')} danger onConfirm={onConfirm} onCancel={onCancel}>
      <p className="confirm__subject">{paper === undefined ? paperKey : paperTitle(paper)}</p>
      <p>{t('dialog.deleteBody')}</p>
    </ConfirmDialog>
  );
}
