import type { JSX } from 'react';

/**
 * The Fractal mark: one stem that branches, and branches again — the same shape
 * at every scale, like a paper and the papers it cites. Drawn with the current
 * text colour so it sits in any theme.
 */
export function FractalMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22V14" strokeWidth="2" />
        <path d="M12 14L6.5 9M12 14l5.5-5" strokeWidth="1.75" />
        <path d="M6.5 9L4 5.5M6.5 9L9 5.5M17.5 9L15 5.5M17.5 9L20 5.5" strokeWidth="1.4" />
        <path d="M4 5.5l-1-1.7M4 5.5l1-1.7M9 5.5l-1-1.7M9 5.5l1-1.7M15 5.5l-1-1.7M15 5.5l1-1.7M20 5.5l-1-1.7M20 5.5l1-1.7" strokeWidth="1.1" />
      </g>
    </svg>
  );
}
