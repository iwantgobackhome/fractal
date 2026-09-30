import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { languageSchema, type ContextSourceStatus, type HistoryEntry, type ModelSelection, type OriginalProvenance, type StructureBox } from '@fractal/shared';
import { Markdown } from '../components/Markdown';
import { Selector } from '../components/Selector';
import { useLanguage } from '../i18n';
import { HubApi, type ProvidersResult } from '../shell/hub-api';
import { TRANSLATION_LANGUAGES } from '../shell/preferences';
import { ReaderSourceStatus } from './ReaderSourceStatus';

export interface ResearchIntent {
  id: number;
  text: string;
  page: number;
  from: 'source' | 'translation';
  rect?: StructureBox;
  kind?: 'figure' | 'equation' | 'table' | 'text';
  provenance?: OriginalProvenance;
}
interface Draft {
  text: string;
  context: ResearchIntent | null;
  requestId: string;
  activeId: string | null;
  model: string;
  answerLanguage?: string;
}
function readDraft(key: string): Draft {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* isolated storage may be unavailable */
  }
  return { text: '', context: null, requestId: crypto.randomUUID(), activeId: null, model: '' };
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
}): JSX.Element {
  const ko = useLanguage() === 'ko';
  const say = (en: string, kr: string) => (ko ? kr : en);
  const key = `fractal.research.${paperKey}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key));
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [providers, setProviders] = useState<ProvidersResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const sending = sendingId === draft.requestId;
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const [languageError, setLanguageError] = useState<string | null>(null);
  const alive = useRef(true),
    seenIntent = useRef<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* draft remains in memory */
    }
  }, [key, draft]);
  const refresh = useCallback(async () => {
    try {
      const rows = await hub.history(paperKey);
      if (!alive.current) return;
      if (rows === null) throw new Error('History service unavailable');
      setEntries(rows);
      setLoaded(true);
      setHistoryError(null);
      setDraft((d) => {
        const retained = rows.find((e) => e.requestId === d.requestId);
        return retained && !d.activeId ? { ...d, activeId: retained.id } : d;
      });
    } catch (cause) {
      if (alive.current) setHistoryError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [hub, paperKey]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    void hub
      .providers()
      .then((p) => {
        if (alive.current) setProviders(p);
      })
      .catch(() => undefined);
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [hub, open, refresh]);
  useEffect(() => {
    if (!intent || seenIntent.current === intent.id) return;
    seenIntent.current = intent.id;
    setDraft((d) => ({ ...d, context: intent, text: '', activeId: null, requestId: crypto.randomUUID() }));
    requestAnimationFrame(() => textarea.current?.focus());
  }, [intent]);
  const defaultChoice = providers?.settings.overrides.chat ?? providers?.settings.default;
  const choiceKey = draft.model || (defaultChoice ? `${defaultChoice.provider}:${defaultChoice.model}` : '');
  const options =
    providers?.providers
      .filter((p) => p.installed)
      .flatMap((p) =>
        p.models.map((m) => ({
          value: `${p.id}:${m.id}`,
          label: m.label,
          description: p.loggedIn ? p.id : say('Sign in required', '로그인 필요'),
          disabled: !p.loggedIn,
        })),
      ) ?? [];
  if (choiceKey && !options.some((o) => o.value === choiceKey))
    options.unshift({ value: choiceKey, label: choiceKey, description: say('Model unavailable', '모델 사용 불가'), disabled: true });
  const modelAvailable = options.some((o) => o.value === choiceKey && !o.disabled);
  const active = entries.find((e) => e.id === draft.activeId) ?? null;
  const run = async (explanation = false, fresh = false) => {
    const current = fresh ? { ...latest.current, requestId: crypto.randomUUID(), activeId: null } : latest.current;
    if (fresh) setDraft(current);
    if (sending || !modelAvailable || (!explanation && !current.text.trim())) return;
    const [provider, ...model] = choiceKey.split(':');
    const selection: ModelSelection = {
      ...(defaultChoice?.effort ? { effort: defaultChoice.effort } : {}),
      provider: provider as ModelSelection['provider'],
      model: model.join(':'),
    };
    const context = current.context;
    setSendingId(current.requestId);
    setError(null);
    try {
      const stream =
        explanation && context?.rect
          ? hub.explain(paperKey, {
              kind: context.kind ?? 'text',
              page: context.page,
              bbox: context.rect,
              surroundingText: context.text,
              requestId: current.requestId,
              selection,
              ...(context.provenance ? { provenance: context.provenance } : {}),
              ...(current.answerLanguage ? { answerLanguage: current.answerLanguage } : {}),
            })
          : hub.ask(paperKey, {
              question: current.text.trim(),
              requestId: current.requestId,
              selection,
              ...(current.answerLanguage ? { answerLanguage: current.answerLanguage } : {}),
              ...(context
                ? {
                    page: context.page,
                    selectedText:
                      context.from === 'translation'
                        ? `[Translated text; physical page ${context.page}; no original position mapping]\n${context.text}`
                        : context.text,
                    ...(context.from === 'source' && context.rect ? { rect: context.rect } : {}),
                    ...(context.provenance ? { provenance: context.provenance } : {}),
                  }
                : {}),
            });
      for await (const event of stream) {
        if (!alive.current) continue;
        if (event.historyId) setDraft((d) => (d.requestId === current.requestId ? { ...d, activeId: event.historyId! } : d));
        await refresh();
      }
    } catch (cause) {
      if (alive.current && latest.current.requestId === current.requestId) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) {
        setSendingId((id) => (id === current.requestId ? null : id));
        await refresh();
      }
    }
  };
  const newQuestion = () => {
    setDraft((d) => ({ ...d, text: '', context: null, activeId: null, requestId: crypto.randomUUID() }));
    setError(null);
    requestAnimationFrame(() => textarea.current?.focus());
  };
  const renderEntry = (entry: HistoryEntry) => (
    <article className="history-entry" key={entry.id} data-history-id={entry.id}>
      <div className="history-entry__meta">
        <span>
          {entry.kind === 'explanation' ? say('Explanation', '설명') : entry.kind === 'conversation' ? say('Conversation', '대화') : say('Question', '질문')}
        </span>
        <span>{new Date(entry.createdAt).toLocaleString(ko ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <h3>
        {entry.kind === 'explanation'
          ? `${say('Explain', '설명')} · ${entry.context.explanationKind ?? say('Selection', '선택 영역')} · p.${entry.context.page ?? '?'}`
          : entry.question || say('Archived conversation', '보관된 대화')}
      </h3>
      {entry.context.page ? (
        <button className="research-provenance" onClick={() => onPage(entry.context.page!)}>
          {say('Original physical page', '원본 실제 페이지')} {entry.context.page}
          {entry.context.explanationKind ? ` · ${entry.context.explanationKind}` : ''}
        </button>
      ) : null}
      {entry.context.rect ? (
        <p className="research-coordinates">
          {say('Original region', '원본 영역')}: {Math.round(entry.context.rect.x * 100)}%, {Math.round(entry.context.rect.y * 100)}% ·{' '}
          {Math.round(entry.context.rect.width * 100)}% × {Math.round(entry.context.rect.height * 100)}%
        </p>
      ) : null}
      {entry.context.selectedText ? <blockquote>{entry.context.selectedText}</blockquote> : null}
      {entry.context.page ? (
        <ReaderSourceStatus provenance={entry.context.provenance} durable={entry.answer?.contextSourceStatus} checkSource={checkSource} />
      ) : null}
      {entry.context.answerLanguage ? (
        <p className="research-coordinates">
          {say('Answer language', '답변 언어')}: {entry.context.answerLanguage}
        </p>
      ) : null}
      {entry.answer?.citations?.length ? (
        <div className="research-citations" aria-label={say('Recorded passage citations', '기록된 인용 출처')}>
          <span>{say('Selected-passage source', '선택 인용 출처')}</span>
          {entry.answer.citations.map((citation, index) => (
            <button key={index} onClick={() => onPage(citation.page)} disabled={citation.paperKey !== paperKey}>
              {say('Original physical page', '원본 실제 페이지')} {citation.page}
              {citation.region ? ` · ${say('passage envelope', '인용 영역')}` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {entry.conversation ? (
        entry.conversation.messages.map((m) => (
          <div key={m.messageId}>
            <strong>{m.role === 'user' ? say('Question', '질문') : say('Answer', '답변')}</strong>
            <Markdown text={m.text} />
            {m.error ? (
              <p role="alert">
                {m.error.code}: {m.error.message}
              </p>
            ) : null}
          </div>
        ))
      ) : (
        <Markdown text={entry.text} caret={['pending', 'running'].includes(entry.status)} />
      )}
      <p className="history-entry__status" role="status">
        {entry.status === 'completed' && !entry.text && !entry.conversation
          ? say('Completed without answer text', '답변 텍스트 없이 완료됨')
          : say(
              ({ pending: 'Queued', running: 'Writing answer', completed: 'Complete', failed: 'Failed', canceled: 'Canceled' } as const)[entry.status],
              ({ pending: '대기 중', running: '답변 작성 중', completed: '완료', failed: '실패', canceled: '취소됨' } as const)[entry.status],
            )}
        {entry.answer ? ` · ${entry.answer.provider} / ${entry.answer.model}` : ''}
      </p>
      {entry.error ? (
        <p role="alert">
          {entry.error.code === 'MODEL_UNAVAILABLE'
            ? say('Model unavailable. Open AI settings to connect an available model.', '모델을 사용할 수 없습니다. AI 설정에서 사용 가능한 모델을 연결하세요.')
            : entry.error.message}
        </p>
      ) : null}
      {entry.error && entry.id === draft.activeId ? (
        <button disabled={!modelAvailable || sending} onClick={() => void run(entry.kind === 'explanation', true)}>
          {say('Retry with a new request', '새 요청으로 재시도')}
        </button>
      ) : null}
      {['pending', 'running'].includes(entry.status) ? (
        <button
          onClick={() =>
            void hub
              .cancelHistory(paperKey, entry.id)
              .then(refresh)
              .catch((e: unknown) => setError(String(e)))
          }
        >
          {say('Cancel generation', '생성 취소')}
        </button>
      ) : null}
      {entry.text ? (
        <button onClick={() => void navigator.clipboard.writeText(entry.text).catch((e: unknown) => setError(String(e)))}>
          {say('Copy answer', '답변 복사')}
        </button>
      ) : null}
      <button
        onClick={() => {
          setDraft((d) => ({
            ...d,
            activeId: entry.id,
            text: entry.kind === 'explanation' ? '' : entry.question,
            requestId: entry.requestId ?? crypto.randomUUID(),
            answerLanguage: entry.context.answerLanguage,
            context: entry.context.page
              ? {
                  id: Date.now(),
                  page: entry.context.page,
                  text: entry.context.selectedText?.replace(/^\[Translated text[^\n]*\]\n/, '') ?? '',
                  from: entry.context.selectedText?.startsWith('[Translated text') ? 'translation' : 'source',
                  rect: entry.context.rect,
                  kind: entry.context.explanationKind,
                  provenance: entry.context.provenance,
                }
              : null,
          }));
          onQuestion();
        }}
      >
        {say('Open', '열기')}
      </button>
    </article>
  );
  const filtered = entries.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (status === 'all' || e.status === status) &&
      `${e.question}\n${e.text}\n${e.context.selectedText ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
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
      <header>
        <h2>{historyMode ? say('Research history', '연구 기록') : say('Questions & explanations', '질문과 설명')}</h2>
        <button aria-label={say('Close research panel', '연구 패널 닫기')} onClick={onClose}>
          ×
        </button>
      </header>
      {historyMode ? (
        <>
          <div className="research-filters">
            <Selector
              label={say('History kind', '기록 유형')}
              value={kind}
              onChange={setKind}
              options={[
                ['all', say('All research', '전체 연구')],
                ['question', say('Questions', '질문')],
                ['explanation', say('Explanations', '설명')],
                ['conversation', say('Conversations', '대화')],
              ].map(([value, label]) => ({ value, label }))}
            />
            <Selector
              label={say('History status', '기록 상태')}
              value={status}
              onChange={setStatus}
              options={['all', 'pending', 'running', 'completed', 'failed', 'canceled'].map((value) => ({
                value,
                label: (
                  {
                    all: say('All statuses', '전체 상태'),
                    pending: say('Queued', '대기 중'),
                    running: say('Writing', '작성 중'),
                    completed: say('Complete', '완료'),
                    failed: say('Failed', '실패'),
                    canceled: say('Canceled', '취소됨'),
                  } as Record<string, string>
                )[value],
              }))}
            />
            <input
              aria-label={say('Search history', '기록 검색')}
              placeholder={say('Search questions and answers', '질문과 답변 검색')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="research-panel__scroll">
            {filtered.map(renderEntry)}
            {loaded && !filtered.length ? (
              <p>{say('No matching history. Adjust the filters or start a question.', '일치하는 기록이 없습니다. 필터를 바꾸거나 질문을 시작하세요.')}</p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="research-panel__scroll">
            {active ? (
              renderEntry(active)
            ) : (
              <p className="research-empty">
                {say(
                  'Ask about this paper, or select original or translated text to include a passage. Previous work stays in History.',
                  '논문에 질문하거나 원본·번역 텍스트를 선택해 인용하세요. 이전 질문과 설명은 기록에 남습니다.',
                )}
              </p>
            )}
          </div>
          <button className="research-new" onClick={newQuestion}>
            {say('+ New question', '+ 새 질문')}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <Selector
              label={say('Question model', '질문 모델')}
              value={choiceKey}
              options={options}
              onChange={(model) => setDraft((d) => ({ ...d, model, requestId: crypto.randomUUID(), activeId: null }))}
            />
            <Selector
              label={say('Answer language', '답변 언어')}
              value={draft.answerLanguage ?? ''}
              options={[
                { value: '', label: say('Hub default', '허브 기본값') },
                { value: 'auto', label: say('Automatic', '자동') },
                ...TRANSLATION_LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
                ...(draft.answerLanguage && draft.answerLanguage !== 'auto' && !TRANSLATION_LANGUAGES.some((l) => l.code === draft.answerLanguage)
                  ? [{ value: draft.answerLanguage, label: draft.answerLanguage }]
                  : []),
              ]}
              onChange={(answerLanguage) =>
                setDraft((d) => ({ ...d, answerLanguage: answerLanguage || undefined, requestId: crypto.randomUUID(), activeId: null }))
              }
            />
            <details className="research-language">
              <summary>{say('Custom language tag', '사용자 지정 언어 코드')}</summary>
              <label>
                {say('BCP47 language tag', 'BCP47 언어 코드')}
                <input value={customLanguage} placeholder="zh-Hant" onChange={(e) => setCustomLanguage(e.target.value)} />
              </label>
              <button
                type="button"
                onClick={() => {
                  const parsed = languageSchema.safeParse(customLanguage.trim());
                  if (!parsed.success) {
                    setLanguageError(say('Enter a valid BCP47 language tag.', '유효한 BCP47 언어 코드를 입력하세요.'));
                    return;
                  }
                  setLanguageError(null);
                  setDraft((d) => ({ ...d, answerLanguage: parsed.data, requestId: crypto.randomUUID(), activeId: null }));
                }}
              >
                {say('Use language', '언어 적용')}
              </button>
              {languageError ? <p role="alert">{languageError}</p> : null}
            </details>
            {draft.context ? (
              <div className="research-context">
                <p>
                  {draft.context.from === 'translation' ? say('Translated passage', '번역문 인용') : say('Original passage / region', '원본 인용 / 영역')} · p.
                  {draft.context.page}
                  {draft.context.kind ? ` · ${draft.context.kind}` : ''}
                </p>
                <blockquote>{draft.context.text || say('Selected region has no extracted text.', '선택한 영역에 추출된 텍스트가 없습니다.')}</blockquote>
                <ReaderSourceStatus provenance={draft.context.provenance} checkSource={checkSource} />
                <button type="button" onClick={() => setDraft((d) => ({ ...d, context: null, requestId: crypto.randomUUID(), activeId: null }))}>
                  {say('Remove context', '인용 제거')}
                </button>
                {draft.context.rect && draft.context.from === 'source' ? (
                  <button type="button" disabled={!modelAvailable || sending} onClick={() => void run(true)}>
                    {say('Explain selection', '선택 영역 설명')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <label>
              {say('Question', '질문')}
              <textarea
                aria-label={say('Question', '질문')}
                ref={textarea}
                value={draft.text}
                maxLength={4000}
                rows={3}
                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value, requestId: crypto.randomUUID(), activeId: null }))}
              />
            </label>
            <button type="submit" disabled={sending || !modelAvailable || !draft.text.trim()}>
              {sending ? say('Sending…', '전송 중…') : say('Ask', '질문하기')}
            </button>
            {!modelAvailable ? (
              <p>
                {say(
                  'Connect an available model to ask or explain. Your draft is retained.',
                  '질문과 설명을 위해 사용 가능한 모델을 연결하세요. 초안은 유지됩니다.',
                )}{' '}
                <button type="button" onClick={onSettings}>
                  {say('AI settings', 'AI 설정')}
                </button>
              </p>
            ) : null}
          </form>
        </>
      )}
      {!loaded ? <p role="status">{say('Loading retained research…', '저장된 연구 기록을 불러오는 중…')}</p> : null}
      {historyError ? (
        <div role="alert">
          <p>{historyError}</p>
          <button onClick={() => void refresh()}>{say('Retry history', '기록 다시 불러오기')}</button>
        </div>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => void refresh()}>{say('Retry history', '기록 다시 불러오기')}</button>
          {draft.text ? (
            <button onClick={() => void run()} disabled={sending || !modelAvailable}>
              {say('Retry same request', '같은 요청 재시도')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
