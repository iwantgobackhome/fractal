import type { Block, Connection, Job, Paper, PauseReason, Translation } from '@fractal/shared';
import { t, type MessageKey } from '../i18n';

/** What the reader is told about one paragraph's translation. */
export type BlockStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unsupported';

export interface TranslationState {
  status: BlockStatus;
  /** The translated text, only when there genuinely is one. */
  text: string | null;
  /** A short explanation for failures; null otherwise. */
  message: string | null;
}

/**
 * Decide what to show for one block.
 *
 * A record whose `sourceHash` no longer matches the block belongs to an older
 * revision of that paragraph and is ignored rather than shown as current.
 * A "completed" record with no text is reported as a failure, because an empty
 * paragraph would silently look like a real translation.
 */
export function describeTranslationState(block: Block, translation: Translation | undefined): TranslationState {
  if (!block.translatable) return { status: 'unsupported', text: null, message: null };
  if (translation === undefined || translation.sourceHash !== block.sourceHash) {
    return { status: 'pending', text: null, message: null };
  }
  switch (translation.status) {
    case 'completed': {
      const text = typeof translation.text === 'string' ? translation.text : '';
      if (text.trim().length === 0) return { status: 'failed', text: null, message: t('status.unreadable') };
      return { status: 'completed', text, message: null };
    }
    case 'failed':
      return { status: 'failed', text: null, message: translation.error?.message ?? t('status.failed') };
    case 'running':
      return { status: 'running', text: null, message: null };
    case 'unsupported':
      return { status: 'unsupported', text: null, message: null };
    default:
      return { status: 'pending', text: null, message: null };
  }
}

/**
 * Why a translation cannot be *started* right now, in the reader's words, or null when
 * it can. Reading a stored translation never needs AI; this gates sending only.
 */
export function translationBlockedReason(connection: Connection | null, paper: Paper | null): string | null {
  if (paper === null) return null;
  if (paper.status !== 'ready' && paper.status !== 'partial') return t('status.waitForExtraction');
  if (connection === null) return t('status.checkingAi');
  switch (connection.status) {
    case 'subscription':
      return connection.modelIds.length === 0 ? t('status.noModels') : null;
    case 'signed_out':
    case 'missing':
    case 'api_key':
      return t('status.aiNotConnected');
    case 'unavailable':
      return t('status.aiUnavailable');
  }
}

/** Preselect the provider's default model, never a model it did not offer. */
export function pickDefaultModel(connection: Connection): string | null {
  const models = connection.modelIds ?? [];
  if (models.length === 0) return null;
  const preferred = connection.defaultModelId;
  return preferred !== null && models.includes(preferred) ? preferred : models[0];
}

const PAPER_STATUS: Record<Paper['status'], MessageKey> = {
  fetching: 'status.fetching',
  extracting: 'status.extracting',
  ready: 'status.ready',
  // 'partial' is the common case for real papers with figures and tables.
  partial: 'status.partial',
  unsupported: 'status.unsupported',
  failed: 'status.fetchFailed',
};

export function paperStatusLabel(paper: Paper): string {
  return t(PAPER_STATUS[paper.status]);
}

/** Why a paused job stopped, in the reader's words. A pause the user asked for needs no note. */
const PAUSE_REASON: Record<Exclude<PauseReason, null>, MessageKey | null> = {
  user: null,
  auth: 'status.pauseAuth',
  quota: 'status.pauseQuota',
  network: 'status.pauseNetwork',
  model_unavailable: 'status.pauseModel',
  interrupted: 'status.pauseInterrupted',
  reextracted: 'status.pauseReextracted',
};

export function pauseReasonNote(reason: PauseReason): string | null {
  if (reason === null) return null;
  const key = PAUSE_REASON[reason];
  return key === null ? null : t(key);
}

export type { Job };
