import { useEffect, useId, useMemo, useState, type JSX, type KeyboardEvent } from 'react';
import { getLanguage, t } from '../i18n';
import { COMMON_FIELDS, fieldName, knownCategories, registerCategories, searchCategories } from './fields';
import type { CustomInterest, HubApi, Interests } from './hub-api';

/** Archive names for browsing the whole list; an archive not named here shows its code. */
const GROUP_NAMES: Record<string, { ko: string; en: string }> = {
  cs: { ko: '컴퓨터 과학', en: 'Computer science' },
  stat: { ko: '통계', en: 'Statistics' },
  eess: { ko: '전기·전자·시스템', en: 'Electrical engineering and systems' },
  math: { ko: '수학', en: 'Mathematics' },
  'q-bio': { ko: '정량 생물학', en: 'Quantitative biology' },
  'q-fin': { ko: '정량 금융', en: 'Quantitative finance' },
  econ: { ko: '경제학', en: 'Economics' },
  physics: { ko: '물리학', en: 'Physics' },
  'astro-ph': { ko: '천체물리학', en: 'Astrophysics' },
  'cond-mat': { ko: '응집물질물리', en: 'Condensed matter' },
  'gr-qc': { ko: '일반상대론·양자우주론', en: 'General relativity and quantum cosmology' },
  'hep-ex': { ko: '고에너지 실험', en: 'High energy physics – experiment' },
  'hep-lat': { ko: '고에너지 격자', en: 'High energy physics – lattice' },
  'hep-ph': { ko: '고에너지 현상론', en: 'High energy physics – phenomenology' },
  'hep-th': { ko: '고에너지 이론', en: 'High energy physics – theory' },
  'math-ph': { ko: '수리물리', en: 'Mathematical physics' },
  nlin: { ko: '비선형 과학', en: 'Nonlinear sciences' },
  'nucl-ex': { ko: '핵물리 실험', en: 'Nuclear experiment' },
  'nucl-th': { ko: '핵물리 이론', en: 'Nuclear theory' },
  'quant-ph': { ko: '양자 물리', en: 'Quantum physics' },
};
const GROUP_ORDER = Object.keys(GROUP_NAMES);

const MAX_FIELDS = 30;

function groupName(group: string): string {
  return GROUP_NAMES[group]?.[getLanguage()] ?? group;
}

type Option = { kind: 'field'; code: string } | { kind: 'custom'; label: string };

/**
 * The reader's fields: any arXiv category, found by name or code, plus fields they name
 * themselves when theirs is not on arXiv's list. Saving keeps the topics and authors the
 * hub already follows.
 */
export function InterestPicker({
  hub,
  onSaved,
  heading = true,
  saveLabel,
}: {
  hub: HubApi;
  onSaved(): void;
  heading?: boolean;
  saveLabel?: string;
}): JSX.Element {
  const [saved, setSaved] = useState<Interests | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomInterest[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [catalogueSize, setCatalogueSize] = useState(knownCategories().length);
  const [dirty, setDirty] = useState(false);
  const listId = useId();

  useEffect(() => {
    hub
      .categories()
      .then((items) => {
        if (items === null || items.length === 0) return;
        registerCategories(items);
        setCatalogueSize(items.length);
      })
      .catch(() => undefined);
    hub
      .interests()
      .then((result) => {
        if (result === null) return;
        setSaved(result.interests);
        const categories = result.interests.categories;
        const own = result.interests.custom ?? [];
        // Fields the library already leans to are chosen to begin with.
        setChosen(categories.length > 0 || own.length > 0 ? categories : result.suggestions.slice(0, 3).map((s) => s.category));
        setCustom(own);
        setSuggested(result.suggestions.map((s) => s.category));
      })
      .catch(() => undefined);
  }, [hub]);

  const full = chosen.length + custom.length >= MAX_FIELDS;
  const matches = useMemo(() => searchCategories(query), [query, catalogueSize]);
  const typed = query.trim();
  const canAddCustom =
    typed.length >= 2 &&
    !custom.some((c) => c.label.toLocaleLowerCase() === typed.toLocaleLowerCase()) &&
    !matches.some((m) => m.code.toLowerCase() === typed.toLowerCase());
  const options: Option[] = [
    ...matches.map((m) => ({ kind: 'field' as const, code: m.code })),
    ...(canAddCustom ? [{ kind: 'custom' as const, label: typed }] : []),
  ];

  const addField = (code: string) => {
    setChosen((current) => (current.includes(code) || full ? current : [...current, code]));
    setDirty(true);
  };
  const removeField = (code: string) => {
    setChosen((current) => current.filter((c) => c !== code));
    setDirty(true);
  };
  const toggleField = (code: string) => (chosen.includes(code) ? removeField(code) : addField(code));
  const addCustom = (label: string) => {
    if (full) return;
    setCustom((current) => [...current, { label, query: '' }]);
    setDirty(true);
  };
  const removeCustom = (item: CustomInterest) => {
    setCustom((current) => current.filter((c) => c !== item));
    setDirty(true);
  };

  const pick = (option: Option) => {
    if (option.kind === 'field') addField(option.code);
    else addCustom(option.label);
    setQuery('');
    setCursor(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setCursor((c) => (c + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setCursor((c) => (c - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[Math.min(cursor, options.length - 1)];
      if (option !== undefined) pick(option);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  };

  const popular = [...new Set([...suggested, ...COMMON_FIELDS])];
  const groups = useMemo(() => {
    const byGroup = new Map<string, string[]>();
    for (const category of knownCategories()) {
      const list = byGroup.get(category.group) ?? [];
      list.push(category.code);
      byGroup.set(category.group, list);
    }
    const order = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
    return [...byGroup].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  }, [catalogueSize]);

  const save = () => {
    setSaving(true);
    const interests: Interests = {
      categories: chosen,
      topics: saved?.topics ?? [],
      authors: saved?.authors ?? [],
      custom: custom.map((c) => ({ ...c, label: c.label.trim() })),
    };
    hub
      .saveInterests(interests)
      .then(() => hub.refreshFeed())
      .then(() => {
        setDirty(false);
        onSaved();
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  const active = options[Math.min(cursor, options.length - 1)];
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <section className="interests" aria-labelledby={heading ? 'interests-title' : undefined} aria-label={heading ? undefined : t('home.fields')}>
      {heading ? (
        <>
          <h1 id="interests-title" className="home-front__headline">
            {t('home.pickTitle')}
          </h1>
          <p className="home-front__deck">{t('home.pickDeck')}</p>
        </>
      ) : null}

      <div className="interests__chosen" aria-live="polite">
        {chosen.length === 0 && custom.length === 0 ? <p className="settings__quiet">{t('interests.none')}</p> : null}
        {chosen.map((code) => (
          <span key={code} className="interest-chip">
            <span>{fieldName(code)}</span>
            <span className="field-toggle__code">{code}</span>
            <button
              type="button"
              className="interest-chip__remove"
              onClick={() => removeField(code)}
              aria-label={t('interests.remove', { name: fieldName(code) })}
            >
              ×
            </button>
          </span>
        ))}
        {custom.map((item) => (
          <span
            key={item.id ?? item.label}
            className="interest-chip interest-chip--own"
            title={item.query !== '' ? t('interests.searchesFor', { query: item.query }) : undefined}
          >
            <span>{item.label}</span>
            <span className="field-toggle__code">{t('interests.own')}</span>
            <button type="button" className="interest-chip__remove" onClick={() => removeCustom(item)} aria-label={t('interests.remove', { name: item.label })}>
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="interest-search">
        <input
          type="search"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-activedescendant={options.length > 0 ? optionId(Math.min(cursor, options.length - 1)) : undefined}
          aria-label={t('interests.searchLabel')}
          placeholder={t('interests.searchPlaceholder')}
          value={query}
          disabled={full}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        {options.length > 0 ? (
          <ul id={listId} className="interest-search__list" role="listbox" aria-label={t('interests.results')}>
            {options.map((option, index) => (
              <li
                key={option.kind === 'field' ? option.code : `custom:${option.label}`}
                id={optionId(index)}
                role="option"
                aria-selected={option === active}
                className="interest-search__option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setCursor(index)}
                onClick={() => pick(option)}
              >
                {option.kind === 'field' ? (
                  <>
                    <span>{fieldName(option.code)}</span>
                    <span className="field-toggle__code">{option.code}</span>
                    {chosen.includes(option.code) ? <span className="interest-search__have">{t('interests.added')}</span> : null}
                  </>
                ) : (
                  <span className="interest-search__custom">{t('interests.addOwn', { label: option.label })}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {full ? <p className="settings__quiet">{t('interests.full', { count: MAX_FIELDS })}</p> : null}

      <p className="interests__kicker">{t('interests.popular')}</p>
      <div className="interests__options" role="group" aria-label={t('interests.popular')}>
        {popular.map((code) => (
          <button key={code} type="button" className="field-toggle" aria-pressed={chosen.includes(code)} onClick={() => toggleField(code)}>
            <span>{fieldName(code)}</span>
            <span className="field-toggle__code">{code}</span>
          </button>
        ))}
      </div>

      <details className="interests__all">
        <summary>{t('interests.browseAll', { count: catalogueSize })}</summary>
        {groups.map(([group, codes]) => (
          <div key={group} className="interests__group">
            <h3 className="interests__group-name">{groupName(group)}</h3>
            <div className="interests__options interests__options--dense" role="group" aria-label={groupName(group)}>
              {codes.map((code) => (
                <button key={code} type="button" className="field-toggle" aria-pressed={chosen.includes(code)} onClick={() => toggleField(code)}>
                  <span>{fieldName(code)}</span>
                  <span className="field-toggle__code">{code}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>

      <button
        type="button"
        className="button interests__save"
        disabled={(chosen.length === 0 && custom.length === 0) || saving || (saveLabel !== undefined && !dirty)}
        onClick={save}
      >
        {saving ? t('home.gathering') : (saveLabel ?? t('home.start'))}
      </button>
    </section>
  );
}
