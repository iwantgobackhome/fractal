import { t } from '../i18n';

/** What the single input box was given: something to open, or words to search for. */
export type InputIntent =
  { kind: 'arxiv'; value: string } | { kind: 'doi'; value: string } | { kind: 'url'; value: string } | { kind: 'search'; value: string } | { kind: 'empty' };

const ARXIV_ID = /^(?:arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)$/i;
const DOI = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i;
const DOI_URL = /^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i;
const ARXIV_URL = /^https?:\/\/(?:www\.)?(?:arxiv\.org|export\.arxiv\.org)\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i;

export function classifyInput(raw: string): InputIntent {
  const value = raw.trim();
  if (value.length === 0) return { kind: 'empty' };

  const arxivUrl = ARXIV_URL.exec(value);
  if (arxivUrl !== null) return { kind: 'arxiv', value: arxivUrl[1] };
  const arxiv = ARXIV_ID.exec(value);
  if (arxiv !== null) return { kind: 'arxiv', value: arxiv[1] };

  const doiUrl = DOI_URL.exec(value);
  if (doiUrl !== null) return { kind: 'doi', value: decodeURIComponent(doiUrl[1]) };
  const doi = DOI.exec(value);
  if (doi !== null) return { kind: 'doi', value: doi[1] };

  if (/^https?:\/\/\S+$/i.test(value)) return { kind: 'url', value };
  return { kind: 'search', value };
}

/** The short verb shown at the end of the input for what Enter will do. */
export function intentAction(intent: InputIntent): string {
  switch (intent.kind) {
    case 'arxiv':
      return t('omni.openArxiv');
    case 'doi':
      return t('omni.openDoi');
    case 'url':
      return t('omni.openUrl');
    case 'search':
      return t('omni.searchLibrary');
    case 'empty':
      return '';
  }
}
