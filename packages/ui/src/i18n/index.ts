import { useSyncExternalStore } from 'react';
import { en } from './en';
import { ko, type Messages } from './ko';

export type Language = 'ko' | 'en';

const DICTIONARIES: Record<Language, Messages> = { ko, en };
const KEY = 'fractal.uiLanguage';

function initial(): Language {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* storage unavailable: use the browser language */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

let current: Language = typeof window === 'undefined' ? 'ko' : initial();
const listeners = new Set<() => void>();

function apply(language: Language): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
apply(current);

export function getLanguage(): Language {
  return current;
}

/** Switch the interface language; every component using `useLanguage` re-renders. */
export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  apply(language);
  try {
    window.localStorage.setItem(KEY, language);
  } catch {
    /* the choice still applies for this session */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current language; the calling component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

function lookup(dictionary: Messages, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * The message for `key` in the current language, with `{name}` placeholders filled.
 * Falls back to Korean, then to the key itself, so a missing entry never blanks the UI.
 */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const template = lookup(DICTIONARIES[current], key) ?? lookup(ko, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** BCP-47 locale for Intl formatting in the current language. */
export function locale(): string {
  return current === 'ko' ? 'ko-KR' : 'en-US';
}
