import { forwardRef, useMemo, useRef, useState, type JSX } from 'react';
import { classifyInput, intentAction, type InputIntent } from './classify';

interface Props {
  busy: boolean;
  disabled: boolean;
  onSubmit: (intent: InputIntent) => void;
  onFile: (file: File) => void;
}

/**
 * One box for everything that brings a paper in: arXiv ids and links, DOIs,
 * any paper URL, or words to search the library. What Enter will do is shown
 * at the end of the field, so no instructions are needed around it.
 */
export const OmniInput = forwardRef<HTMLInputElement, Props>(function OmniInput({ busy, disabled, onSubmit, onFile }, ref): JSX.Element {
  const [value, setValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const intent = useMemo(() => classifyInput(value), [value]);
  const action = intentAction(intent);

  return (
    <form
      className="omni"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (intent.kind === 'empty' || busy) return;
        onSubmit(intent);
        if (intent.kind !== 'search') setValue('');
      }}
    >
      <label htmlFor="omni-input" className="sr-only">
        arXiv 번호, DOI, 논문 주소 또는 검색어
      </label>
      <input
        ref={ref}
        id="omni-input"
        className="omni__field"
        type="text"
        value={value}
        placeholder="arXiv · DOI · 논문 주소 · 검색"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setValue('');
            event.currentTarget.blur();
          }
        }}
      />
      {action !== '' ? (
        <button type="submit" className="omni__action" disabled={busy || disabled}>
          {busy ? '여는 중' : action}
          <kbd aria-hidden="true">↵</kbd>
        </button>
      ) : (
        <button type="button" className="omni__action omni__action--quiet" disabled={disabled} onClick={() => fileRef.current?.click()}>
          PDF 올리기
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onFile(file);
          event.target.value = '';
        }}
      />
    </form>
  );
});
