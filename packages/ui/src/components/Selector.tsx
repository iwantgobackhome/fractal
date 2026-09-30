import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectorOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A single-choice listbox. Focus stays on the combobox; active options scroll into view. */
export function Selector({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
}: {
  id?: string;
  label: string;
  value: string;
  options: SelectorOption[];
  onChange(value: string): void;
  disabled?: boolean;
  loading?: boolean;
}): JSX.Element {
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const search = useRef({ text: '', time: 0 });
  const selected = options.find((option) => option.value === value);
  const available = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  const requested = options.findIndex((option) => option.value === activeValue && !option.disabled);
  const active = requested >= 0 ? requested : (available.find((index) => options[index].value === value) ?? available[0] ?? -1);
  const setActive = (index: number) => setActiveValue(options[index]?.value ?? null);
  const blocked = disabled || loading || available.length === 0;
  const show = (last = false) => {
    if (blocked) return;
    const current = options.findIndex((option) => option.value === value && !option.disabled);
    setActive(current >= 0 ? current : last ? available.at(-1)! : available[0]);
    setOpen(true);
  };
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !list.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom < 0 || rect.top > innerHeight) {
        setOpen(false);
        return;
      }
      const width = Math.min(Math.max(rect.width, 260), innerWidth - 24);
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 180 && above > below;
      setPopupStyle({
        width,
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        maxHeight: Math.min(340, Math.max(60, upward ? above - 4 : below - 4)),
        ...(upward ? { bottom: innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${uid}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, uid]);
  const choose = (index: number) => {
    if (!options[index] || options[index].disabled) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show(event.key === 'ArrowUp');
        if (event.key === 'Home') setActive(available[0]);
        if (event.key === 'End') setActive(available.at(-1)!);
        return;
      }
      if (event.key === 'Home') setActive(available[0]);
      else if (event.key === 'End') setActive(available.at(-1)!);
      else {
        const index = available.indexOf(active);
        setActive(available[(index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active);
      else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
      const found = available.find((index) => options[index].label.toLowerCase().startsWith(search.current.text));
      if (found !== undefined) {
        event.preventDefault();
        setActive(found);
        setOpen(true);
      }
    }
  };
  return (
    <div
      ref={root}
      className="selector"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className="selector__trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-busy={loading || undefined}
        aria-activedescendant={open && active >= 0 ? `${uid}-option-${active}` : undefined}
        disabled={blocked}
        onKeyDown={keyDown}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{selected?.label ?? (value || label)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open
        ? createPortal(
            <div ref={list} id={listId} style={popupStyle} className="selector__list" role="listbox" aria-label={label}>
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={`${uid}-option-${index}`}
                  role="option"
                  aria-selected={value === option.value}
                  aria-disabled={option.disabled || undefined}
                  data-active={index === active}
                  className="selector__option"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                  {value === option.value ? (
                    <span className="selector__check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
