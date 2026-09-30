import { useCallback, useEffect, useRef, useState } from 'react';
import { getLanguage, setLanguage, type Language } from '../i18n';
import type { HubApi, Preferences } from './hub-api';

/** Languages papers can be translated into, named in their own language. */
export const TRANSLATION_LANGUAGES: { code: string; name: string }[] = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
];

export const UI_LANGUAGES: { code: Language; name: string }[] = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
];

const LOCAL_KEY = 'fractal.preferences';

function readLocal(): Preferences {
  const language = getLanguage();
  const fallback: Preferences = { uiLanguage: language, translationLanguage: language, answerLanguage: 'auto', onboardingCompleted: false };
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return fallback;
  }
}

function writeLocal(preferences: Preferences): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(preferences));
  } catch {
    /* the hub keeps the durable copy */
  }
}

/**
 * The reader's language and first-run preferences. The hub is the source of truth
 * (the tablet reads them too); a local copy answers before the hub does and when an
 * older hub has no preferences route.
 */
export function usePreferences(hub: HubApi): [Preferences | null, (change: Partial<Preferences>) => void] {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const latest = useRef<Preferences | null>(null);
  latest.current = preferences;

  useEffect(() => {
    const local = readLocal();
    hub
      .preferences()
      .then((remote) => {
        const next = remote ?? local;
        setLanguage(next.uiLanguage);
        writeLocal(next);
        setPreferences(next);
      })
      .catch(() => setPreferences(local));
  }, [hub]);

  const update = useCallback(
    (change: Partial<Preferences>) => {
      // The hub replaces the whole record, so it always receives every field.
      const next = { ...(latest.current ?? readLocal()), ...change };
      latest.current = next;
      if (change.uiLanguage !== undefined) setLanguage(change.uiLanguage);
      writeLocal(next);
      setPreferences(next);
      hub.savePreferences(next).catch(() => undefined);
    },
    [hub],
  );

  return [preferences, update];
}
