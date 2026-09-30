import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { t } from '../i18n';

export interface Command {
  id: string;
  label: string;
  /** Group heading: 이동, 논문, 보기 … */
  group: string;
  /** Extra words that should match, e.g. English names or authors. */
  keywords?: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

/** Every word of the query must appear somewhere in the label or keywords. */
export function matchCommand(command: Command, query: string): boolean {
  const haystack = `${command.label} ${command.keywords ?? ''} ${command.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((word) => haystack.includes(word));
}

export function CommandPalette({ open, commands, onClose }: Props): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const results = useMemo(() => commands.filter((c) => matchCommand(c, query)).slice(0, 40), [commands, query]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (command === undefined) return;
    onClose();
    command.run();
  };

  let lastGroup = '';
  return (
    <div className="palette-layer">
      <button type="button" className="palette-scrim" aria-label={t('palette.close')} tabIndex={-1} onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <input
          ref={inputRef}
          className="palette__field"
          type="text"
          value={query}
          placeholder={t('palette.placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] !== undefined ? `palette-${results[active].id}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(results[active]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <ul ref={listRef} id="palette-list" className="palette__list" role="listbox" aria-label={t('palette.results')}>
          {results.length === 0 ? <li className="palette__empty">{t('palette.empty')}</li> : null}
          {results.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id} role="presentation">
                {heading !== null ? <div className="palette__group">{heading}</div> : null}
                <div
                  id={`palette-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  className="palette__item"
                  onPointerMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span className="palette__label">{command.label}</span>
                  {command.hint !== undefined ? <span className="palette__hint">{command.hint}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
