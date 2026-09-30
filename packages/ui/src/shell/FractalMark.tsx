import type { JSX } from 'react';

/**
 * The Fractal mark: one stem that branches, and branches again — the same shape
 * at every scale, like a paper and the papers it cites. Drawn with the current
 * text colour so it sits in any theme.
 */
export function FractalMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 31V22M20 22l-8-7m8 7 8-7" strokeWidth="2.4" />
        <path d="m12 15-4-5m4 5 4-5m12 5-4-5m4 5 4-5" strokeWidth="1.9" />
        <path d="m8 10-2-3m2 3 2-3m6 3-2-3m2 3 2-3m6 3-2-3m2 3 2-3m6 3-2-3m2 3 2-3" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
