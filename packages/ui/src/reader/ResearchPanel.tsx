import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ContextSourceStatus, HistoryEntry, ModelSelection, OriginalProvenance, StructureBox } from '@fractal/shared';
import { Markdown } from '../components/Markdown';
import { Selector } from '../components/Selector';
import { useLanguage } from '../i18n';
import { HubApi, type ProvidersResult } from '../shell/hub-api';
import { useResearchRequest } from './useResearchRequest';
import { ReaderSourceStatus } from './ReaderSourceStatus';
import { groupThreads, reduceDraft, threadKey, type ResearchDraft } from './research-state';
export interface ResearchIntent {
  id: number;
  text: string;
  page: number;
  from: 'source' | 'translation';
  rect?: StructureBox;
  kind?: 'figure' | 'equation' | 'table' | 'text';
  provenance?: OriginalProvenance;
}
function readDraft(key: string, popup: boolean): ResearchDraft {
  const empty = { threadId: crypto.randomUUID(), text: '', context: null, model: '' };
  if (popup) return empty;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    return saved ? { ...empty, ...saved, threadId: saved.threadId ?? saved.activeId ?? empty.threadId } : empty;
  } catch {
    return empty;
  }
}
export function ResearchPanel({
  hub,
  paperKey,
  open,
  historyMode,
  intent,
  onClose,
  onPage,
  onSettings,
  onQuestion,
  checkSource,
  popup = false,
  answerLanguage,
}: {
  hub: HubApi;
  paperKey: string;
  open: boolean;
  historyMode: boolean;
  intent: ResearchIntent | null;
  onClose(): void;
  onPage(page: number): void;
  onSettings(): void;
  onQuestion(): void;
  checkSource(provenance?: OriginalProvenance): Promise<ContextSourceStatus>;
  popup?: boolean;
  answerLanguage?: string;
}): JSX.Element {
  const ko = useLanguage() === 'ko',
    say = (en: string, kr: string) => (ko ? kr : en);
  const key = `fractal.research.${paperKey}`;
  const [draft, setDraft] = useState(() => readDraft(key, popup));
  const [entries, setEntries] = useState<HistoryEntry[]>([]),
    [providers, setProviders] = useState<ProvidersResult | null>(null);
  const [error, setError] = useState<string | null>(null),
    [historyError, setHistoryError] = useState<string | null>(null),
    [sending, setSending] = useState(false);
  const [search, setSearch] = useState(''),
    [kind, setKind] = useState('all'),
    [status, setStatus] = useState('all');
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    seen = useRef<number | null>(null),
    auto = useRef<number | null>(null),
    busy = useRef(false),
    alive = useRef(true);
  const latest = useRef(draft);
  latest.current = draft;
  const request = useResearchRequest(hub, paperKey);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (popup) return;
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [key, draft, popup]);
  const refresh = useCallback(async () => {
    try {
      const rows = await hub.history(paperKey);
      if (!rows) throw new Error('History service unavailable');
      if (alive.current) {
        setEntries(rows);
        setHistoryError(null);
      }
    } catch (e) {
      if (alive.current) setHistoryError(String(e));
    }
  }, [hub, paperKey]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    void hub
      .providers()
      .then(setProviders)
      .catch(() => undefined);
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [open, hub, refresh]);
  useEffect(() => {
    if (!intent || seen.current === intent.id) return;
    seen.current = intent.id;
    setDraft((d) => ({ ...d, context: intent }));
    requestAnimationFrame(() => textarea.current?.focus());
  }, [intent]);
  const defaultChoice = providers?.settings.overrides.chat ?? providers?.settings.default;
  const choice = draft.model || (defaultChoice ? `${defaultChoice.provider}:${defaultChoice.model}` : '');
  const options =
    providers?.providers
      .filter((p) => p.installed)
      .flatMap((p) => p.models.map((m) => ({ value: `${p.id}:${m.id}`, label: m.label, disabled: !p.loggedIn }))) ?? [];
  const available = options.some((o) => o.value === choice && !o.disabled);
  const run = async (explanation = false, retry?: HistoryEntry) => {
    const current = latest.current,
      context = retry
        ? retry.context.page
          ? {
              id: Date.now(),
              page: retry.context.page,
              text: retry.context.selectedText?.replace(/^\[Translated text[^\n]*\]\n/, '') ?? '',
              from: retry.context.selectedText?.startsWith('[Translated text') ? ('translation' as const) : ('source' as const),
              rect: retry.context.rect,
              kind: retry.context.explanationKind,
              provenance: retry.context.provenance,
            }
          : null
        : current.context;
    const question = retry?.question ?? current.text;
    if (busy.current || !available || (!explanation && !question.trim())) return;
    busy.current = true;
    setSending(true);
    setError(null);
    atBottom.current = true;
    const requestId = crypto.randomUUID(),
      [provider, ...model] = choice.split(':');
    const selection = { ...defaultChoice, provider: provider as ModelSelection['provider'], model: model.join(':') };
    if (!retry) setDraft((d) => reduceDraft(d, { type: 'sent' }));
    try {
      await request({ context, question, requestId, threadId: current.threadId, selection, answerLanguage, explanation, onHistory: () => {}, refresh });
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        if (!retry) setDraft((d) => (d.threadId === current.threadId && !d.text && !d.context ? { ...d, text: question, context } : d));
      }
    } finally {
      busy.current = false;
      if (alive.current) {
        setSending(false);
        void refresh();
      }
    }
  };
  useEffect(() => {
    if (!intent?.rect || !intent.kind || intent.kind === 'text' || draft.context?.id !== intent.id || !available || sending || auto.current === intent.id)
      return;
    auto.current = intent.id;
    void run(true);
  }, [intent, draft.context, available, sending]);
  const turns = entries.filter((e) => threadKey(e) === draft.threadId || e.id === draft.threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => {
    if (atBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [entries, draft.threadId]);
  const attachment = (entry: HistoryEntry) =>
    entry.context.selectedText ? (
      <details className="research-turn__quote">
        <summary>
          📎 p.{entry.context.page} · {entry.context.selectedText.replace(/^\[Translated text[^\n]*\]\n/, '').slice(0, 80)}
          {entry.context.selectedText.length > 80 ? '…' : ''}
        </summary>
        <blockquote>{entry.context.selectedText.replace(/^\[Translated text[^\n]*\]\n/, '')}</blockquote>
      </details>
    ) : null;
  const renderTurn = (entry: HistoryEntry) => (
    <article className="history-entry research-turn" key={entry.id} data-history-id={entry.id}>
      <div className="research-turn__user">
        {attachment(entry)}
        <p>{entry.question || `${say('Explain', '설명')} · ${entry.context.explanationKind ?? ''}`}</p>
        {entry.context.page ? (
          <button className="research-provenance" onClick={() => onPage(entry.context.page!)}>
            p.{entry.context.page}
          </button>
        ) : null}
      </div>
      <div className="research-turn__answer">
        {entry.context.page ? (
          <ReaderSourceStatus problemsOnly provenance={entry.context.provenance} durable={entry.answer?.contextSourceStatus} checkSource={checkSource} />
        ) : null}
        {entry.conversation ? (
          entry.conversation.messages.map((m) => (
            <div key={m.messageId}>
              <strong>{m.role === 'user' ? say('Question', '질문') : say('Answer', '답변')}</strong>
              <Markdown text={m.text} />
            </div>
          ))
        ) : (
          <Markdown text={entry.text} caret={['pending', 'running'].includes(entry.status)} />
        )}
        {['pending', 'running', 'failed'].includes(entry.status) ? (
          <p role="status">{entry.status === 'failed' ? say('Failed', '실패') : say('Writing answer…', '답변 작성 중…')}</p>
        ) : null}
        {entry.error ? <p role="alert">{entry.error.message}</p> : null}
        {entry.answer?.citations?.map((c, i) => (
          <button key={i} className="research-provenance" disabled={c.paperKey !== paperKey} onClick={() => onPage(c.page)}>
            p.{c.page}
          </button>
        ))}
        <div className="research-turn__actions">
          {entry.text ? (
            <button
              aria-label={say('Copy answer', '답변 복사')}
              title={say('Copy answer', '답변 복사')}
              onClick={() => void navigator.clipboard.writeText(entry.text).catch((e) => setError(String(e)))}
            >
              ⧉
            </button>
          ) : null}
          {!['pending', 'running'].includes(entry.status) ? (
            <button
              aria-label={say('Retry', '재시도')}
              title={say('Retry', '재시도')}
              disabled={sending || !available}
              onClick={() => void run(entry.kind === 'explanation', entry)}
            >
              ↻
            </button>
          ) : null}
          {['pending', 'running'].includes(entry.status) ? (
            <button
              aria-label={say('Cancel generation', '생성 취소')}
              title={say('Cancel generation', '생성 취소')}
              onClick={() =>
                void hub
                  .cancelHistory(paperKey, entry.id)
                  .then(refresh)
                  .catch((e) => setError(String(e)))
              }
            >
              ■
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
  const threads = groupThreads(entries).filter((rows) =>
    rows.some(
      (e) =>
        (kind === 'all' || e.kind === kind) &&
        (status === 'all' || e.status === status) &&
        `${e.question} ${e.text} ${e.context.selectedText ?? ''}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <div
      className="research-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {!popup ? (
        <header>
          <h2>{historyMode ? say('Research history', '연구 기록') : say('Questions', '질문')}</h2>
          <button aria-label={say('Close research panel', '연구 패널 닫기')} onClick={onClose}>
            ×
          </button>
        </header>
      ) : null}
      {historyMode ? (
        <>
          <div className="research-filters">
            <input
              aria-label={say('Search history', '기록 검색')}
              placeholder={say('Search threads', '대화 검색')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Selector
              label={say('History kind', '기록 유형')}
              value={kind}
              onChange={setKind}
              options={['all', 'question', 'explanation', 'conversation'].map((value) => ({
                value,
                label: (
                  {
                    all: say('All', '전체'),
                    question: say('Questions', '질문'),
                    explanation: say('Explanations', '설명'),
                    conversation: say('Conversations', '대화'),
                  } as Record<string, string>
                )[value],
              }))}
            />
            <Selector
              label={say('History status', '기록 상태')}
              value={status}
              onChange={setStatus}
              options={['all', 'pending', 'running', 'completed', 'failed', 'canceled'].map((value) => ({
                value,
                label: (
                  {
                    all: say('All', '전체'),
                    pending: say('Queued', '대기'),
                    running: say('Writing', '작성 중'),
                    completed: say('Complete', '완료'),
                    failed: say('Failed', '실패'),
                    canceled: say('Canceled', '취소'),
                  } as Record<string, string>
                )[value],
              }))}
            />
          </div>
          <div className="research-panel__scroll">
            {threads.map((rows) => (
              <button
                className="research-thread"
                key={threadKey(rows[0])}
                onClick={() => {
                  setDraft((d) => ({ ...d, threadId: threadKey(rows[0]), text: '', context: null }));
                  atBottom.current = true;
                  onQuestion();
                }}
              >
                <strong>{rows[0].question || say('Explanation', '설명')}</strong>
                <span>
                  {rows.length} {say('turns', '개 질문')} · {new Date(rows[rows.length - 1].createdAt).toLocaleDateString(ko ? 'ko-KR' : 'en-US')}
                </span>
              </button>
            ))}
            {!threads.length ? <p>{say('No matching history', '일치하는 기록이 없습니다')}</p> : null}
          </div>
        </>
      ) : (
        <>
          <div
            className="research-panel__scroll"
            ref={scroll}
            onScroll={() => {
              const node = scroll.current;
              if (node) atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
            }}
          >
            {turns.map(renderTurn)}
            {!turns.length ? (
              <p className="research-empty">
                {say('Ask about this paper. Select text to attach a passage.', '논문에 질문하세요. 텍스트를 선택해 인용을 첨부할 수 있습니다.')}
              </p>
            ) : null}
          </div>
          <button
            className="research-new"
            onClick={() => {
              setDraft((d) => reduceDraft(d, { type: 'new', threadId: crypto.randomUUID() }));
              setError(null);
              atBottom.current = true;
              requestAnimationFrame(() => textarea.current?.focus());
            }}
          >
            {say('+ New question', '+ 새 질문')}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {draft.context ? (
              <div className="research-attachment">
                <span>
                  📎 p.{draft.context.page} · {draft.context.from === 'translation' ? say('Translation', '번역문') : say('Original', '원문')} “
                  {draft.context.text.slice(0, 80)}
                  {draft.context.text.length > 80 ? '…' : ''}”
                </span>
                <button
                  type="button"
                  aria-label={say('Remove attachment', '인용 제거')}
                  onClick={() => setDraft((d) => reduceDraft(d, { type: 'removeAttachment' }))}
                >
                  ×
                </button>
              </div>
            ) : null}
            <textarea
              aria-label={say('Question', '질문')}
              placeholder={say('Ask a question…', '질문을 입력하세요…')}
              ref={textarea}
              rows={3}
              maxLength={4000}
              value={draft.text}
              onChange={(e) => setDraft((d) => reduceDraft(d, { type: 'text', text: e.target.value }))}
            />
            <div className="research-compose-row">
              <Selector label={say('Question model', '질문 모델')} value={choice} options={options} onChange={(model) => setDraft((d) => ({ ...d, model }))} />
              <button type="submit" disabled={sending || !available || !draft.text.trim()}>
                {sending ? say('Sending…', '전송 중…') : say('Send', '전송')}
              </button>
            </div>
            {!available ? (
              <p>
                {say('Connect a model in Settings.', '설정에서 모델을 연결하세요.')}{' '}
                <button type="button" onClick={onSettings}>
                  {say('AI settings', 'AI 설정')}
                </button>
              </p>
            ) : null}
          </form>
        </>
      )}
      {historyError ? (
        <div role="alert">
          {historyError}
          <button onClick={() => void refresh()}>{say('Retry history', '기록 다시 불러오기')}</button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
