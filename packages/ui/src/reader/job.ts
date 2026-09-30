import type { Job } from '@fractal/shared';
import { t } from '../i18n';
import { pauseReasonNote } from '../lib/status';

/** The translation's state in a few words, with why it stopped when it paused on its own. */
export function jobLabel(job: Job | null): string {
  if (job === null || job.state === 'idle') return t('job.idle');
  switch (job.state) {
    case 'running':
      return t('job.running');
    case 'paused': {
      const note = pauseReasonNote(job.pauseReason);
      return note === null ? t('job.paused') : `${t('job.paused')} — ${note}`;
    }
    case 'failed':
      return t('job.failed');
    case 'completed':
    case 'completed_with_gaps':
      return t('job.saved');
  }
}

export function primaryLabel(job: Job | null): string {
  if (job === null || job.state === 'idle') return t('job.start');
  switch (job.state) {
    case 'paused':
    case 'failed':
      return t('job.resume');
    case 'running':
      return t('job.pause');
    case 'completed':
    case 'completed_with_gaps':
      return t('job.saved');
  }
}

export function primaryAction(job: Job | null): 'start' | 'pause' | 'resume' | 'saved' {
  if (job === null || job.state === 'idle') return 'start';
  if (job.state === 'paused' || job.state === 'failed') return 'resume';
  if (job.state === 'running') return 'pause';
  return 'saved';
}
