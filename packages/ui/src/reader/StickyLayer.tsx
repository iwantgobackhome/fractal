import { useEffect, useRef, useState, type JSX } from 'react';
import type { Memo } from '@fractal/shared';
import { Selector } from '../components/Selector';
import { useLanguage } from '../i18n';

export function boundedRect(rect: NonNullable<Memo['rect']>): NonNullable<Memo['rect']> {
  const width = Math.min(1, Math.max(0.12, rect.width)),
    height = Math.min(1, Math.max(0.08, rect.height));
  return { x: Math.max(0, Math.min(1 - width, rect.x)), y: Math.max(0, Math.min(1 - height, rect.y)), width, height };
}
function Sticky({ memo, onSave }: { memo: Memo; onSave(memo: Memo): void }): JSX.Element {
  const ko = useLanguage() === 'ko',
    say = (en: string, kr: string) => (ko ? kr : en);
  const storageKey = `fractal.memo-draft.${memo.id}`;
  const [initialDraft] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const value = JSON.parse(raw) as { text: string; baseUpdatedAt: string };
      return value.baseUpdatedAt === memo.updatedAt ? value.text : null;
    } catch {
      return null;
    }
  });
  const [body, setBody] = useState(initialDraft ?? memo.text);
  const dirty = useRef(initialDraft !== null && initialDraft !== memo.text);
  const [moving, setMoving] = useState<Memo['rect']>(null);
  const host = useRef<HTMLDivElement>(null);
  const rect = moving ?? memo.rect ?? { x: 0.1, y: 0.1, width: 0.3, height: 0.22 };
  const save = (change: Partial<Memo> = {}) => {
    onSave({ ...memo, text: body, ...change });
    dirty.current = false;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* pending annotation cache retains the mutation */
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty.current || body === memo.text) return;
    const timer = setTimeout(() => saveRef.current(), 500);
    return () => clearTimeout(timer);
  }, [body, memo.text]);
  useEffect(() => {
    if (!dirty.current) setBody(memo.text);
  }, [memo.text, memo.updatedAt]);
  const drag = (event: React.PointerEvent, resize: boolean) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const page = host.current?.parentElement?.parentElement?.getBoundingClientRect();
    if (!page) return;
    const x = event.clientX,
      y = event.clientY;
    let next = rect;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - x) / page.width,
        dy = (e.clientY - y) / page.height;
      next = boundedRect(resize ? { ...rect, width: rect.width + dx, height: rect.height + dy } : { ...rect, x: rect.x + dx, y: rect.y + dy });
      setMoving(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      save({ rect: next });
      setMoving(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  return (
    <div
      ref={host}
      className={`sticky-note sticky-note--${memo.color ?? 'yellow'}${memo.collapsed ? ' is-collapsed' : ''}`}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: memo.collapsed ? undefined : `${rect.width * 100}%`,
        height: memo.collapsed ? undefined : `${rect.height * 100}%`,
      }}
      data-memo-id={memo.id}
    >
      <div className="sticky-note__heading">
        <button
          className="sticky-note__move"
          aria-label={say('Move note; arrows move, Shift + arrows resize', '메모 이동: 방향키 이동, Shift + 방향키 크기 조절')}
          onPointerDown={(e) => drag(e, false)}
          onKeyDown={(e) => {
            const delta =
              e.key === 'ArrowLeft'
                ? [-0.01, 0]
                : e.key === 'ArrowRight'
                  ? [0.01, 0]
                  : e.key === 'ArrowUp'
                    ? [0, -0.01]
                    : e.key === 'ArrowDown'
                      ? [0, 0.01]
                      : null;
            if (!delta) return;
            e.preventDefault();
            e.stopPropagation();
            save({
              rect: boundedRect(
                e.shiftKey
                  ? { ...rect, width: rect.width + delta[0], height: rect.height + delta[1] }
                  : { ...rect, x: rect.x + delta[0], y: rect.y + delta[1] },
              ),
            });
          }}
        >
          p.{memo.page} · {say('Note', '메모')}
        </button>
        <button
          aria-label={memo.collapsed ? say('Reopen note', '메모 다시 열기') : say('Collapse note', '메모 접기')}
          onClick={() => save({ collapsed: !memo.collapsed })}
        >
          {memo.collapsed ? '+' : '−'}
        </button>
      </div>
      {!memo.collapsed ? (
        <div className="sticky-note__body">
          {memo.quote ? <blockquote>{memo.quote}</blockquote> : null}
          <label className="sr-only" htmlFor={`memo-${memo.id}`}>
            {say('Note body', '메모 본문')}
          </label>
          <textarea
            id={`memo-${memo.id}`}
            value={body}
            onBlur={() => {
              if (body !== memo.text) save();
            }}
            onChange={(e) => {
              dirty.current = true;
              setBody(e.target.value);
              try {
                localStorage.setItem(storageKey, JSON.stringify({ text: e.target.value, baseUpdatedAt: memo.updatedAt }));
              } catch {
                /* retained in memory */
              }
            }}
          />
          <Selector
            label={say('Note color', '메모 색상')}
            value={memo.color ?? 'yellow'}
            options={['yellow', 'green', 'blue', 'pink'].map((value) => ({
              value,
              label: (
                { yellow: say('Yellow', '노랑'), green: say('Green', '초록'), blue: say('Blue', '파랑'), pink: say('Pink', '분홍') } as Record<string, string>
              )[value],
            }))}
            onChange={(color) => save({ color: color as Memo['color'] })}
          />
          <div className="sticky-note__actions">
            <button onClick={() => save()}>{say('Save note', '메모 저장')}</button>
            <button
              onClick={() => {
                if (confirm(say('Delete this note and its body?', '메모와 본문을 삭제할까요?'))) save({ deleted: true });
              }}
            >
              {say('Delete note', '메모 삭제')}
            </button>
          </div>
          <button
            className="sticky-note__resize"
            aria-label={say('Resize note; Shift + arrow keys on heading also resize', '메모 크기 조절: 제목에서 Shift + 방향키도 사용 가능')}
            onPointerDown={(e) => drag(e, true)}
          >
            ↘
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function StickyLayer({ memos, onSave }: { memos: Memo[]; onSave(memo: Memo): void }): JSX.Element {
  return (
    <div className="sticky-layer">
      {memos
        .filter((m) => !m.deleted)
        .map((memo) => (
          <Sticky key={memo.id} memo={memo} onSave={onSave} />
        ))}
    </div>
  );
}
