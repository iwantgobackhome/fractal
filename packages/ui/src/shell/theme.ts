import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark' | 'sepia';

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '밝게' },
  { value: 'sepia', label: '세피아' },
  { value: 'dark', label: '어둡게' },
];

const KEY = 'fractal.theme';

function read(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'sepia' || value === 'system') return value;
  } catch {
    /* storage unavailable: fall back to the system theme */
  }
  return 'system';
}

/** `system` leaves the attribute off so tokens.css follows prefers-color-scheme. */
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => apply(choice), [choice]);
  const update = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this session */
    }
  }, []);
  return [choice, update];
}

/** The next theme in the quick-toggle order used by the command palette. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  const order: ThemeChoice[] = ['light', 'sepia', 'dark'];
  const index = order.indexOf(choice);
  return order[(index + 1) % order.length];
}
