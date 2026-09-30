import { z } from 'zod';

/** BCP 47 tags, including ko, en, ja, zh-Hans, zh-Hant, de, fr, and es. */
export const languageSchema = z
  .string()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'Invalid BCP 47 language tag');
export const preferencesSchema = z.object({
  uiLanguage: z.enum(['ko', 'en']),
  translationLanguage: languageSchema,
  answerLanguage: z.union([z.literal('auto'), languageSchema]),
  onboardingCompleted: z.boolean(),
});
export type Language = z.infer<typeof languageSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;

export function defaultPreferences(locale = Intl.DateTimeFormat().resolvedOptions().locale): Preferences {
  const uiLanguage = locale.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  return { uiLanguage, translationLanguage: uiLanguage, answerLanguage: 'auto', onboardingCompleted: false };
}
