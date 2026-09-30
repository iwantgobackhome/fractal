import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { t, type MessageKey } from '../i18n';
import type { FieldTopic, HubApi } from './hub-api';

const GROUPS: { origin: FieldTopic['origin']; label: MessageKey; hint: MessageKey }[] = [
  { origin: 'trending', label: 'topics.trending', hint: 'topics.trendingHint' },
  { origin: 'suggested', label: 'topics.suggested', hint: 'topics.suggestedHint' },
  { origin: 'curated', label: 'topics.curated', hint: 'topics.curatedHint' },
  { origin: 'user', label: 'topics.own', hint: 'topics.ownHint' },
];

/**
 * The names a field's news follows: products, labs, models and ideas people are writing
 * about this week. Followed topics get their own news searches on the next gathering.
 */
export function TopicManager({
  hub,
  field,
  fieldName,
  onClose,
}: {
  hub: HubApi;
  field: string;
  fieldName: string;
  onClose(changed: boolean): void;
}): JSX.Element {
  const [topics, setTopics] = useState<FieldTopic[] | null | undefined>(undefined);
  const [label, setLabel] = useState('');
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    hub
      .topics(field)
      .then(setTopics)
      .catch(() => setTopics(null));
  }, [hub, field]);

  useEffect(() => {
    doneRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose(changed);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, changed]);

  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : t('errors.request'));

  const toggle = (topic: FieldTopic) => {
    setTopics((current) => current?.map((item) => (item.id === topic.id ? { ...item, followed: !topic.followed } : item)) ?? current);
    setChanged(true);
    hub.followTopic(topic.id, !topic.followed).catch(fail);
  };

  const remove = (topic: FieldTopic) => {
    setTopics((current) => current?.filter((item) => item.id !== topic.id) ?? current);
    setChanged(true);
    hub.removeTopic(topic.id).catch(fail);
  };

  const add = () => {
    const name = label.trim();
    if (name.length < 2) return;
    setLabel('');
    hub
      .addTopic(field, name)
      .then((topic) => {
        if (topic === null) return;
        setTopics((current) => [...(current ?? []), topic]);
        setChanged(true);
      })
      .catch(fail);
  };

  const followed = topics?.filter((topic) => topic.followed) ?? [];

  return (
    <div className="dialog-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose(changed)}>
      <div className="confirm topic-manager" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="confirm__title">
          {t('topics.title', { field: fieldName })}
        </h2>
        <p className="settings__quiet">{t('topics.deck')}</p>

        {topics === undefined ? (
          <p className="settings__quiet">{t('settings.loading')}</p>
        ) : topics === null ? (
          <p className="settings__quiet">{t('settings.unavailable')}</p>
        ) : (
          <>
            <h3 className="topic-manager__group">{t('topics.following', { count: followed.length })}</h3>
            <div className="topic-manager__chips">
              {followed.length === 0 ? <span className="settings__quiet">{t('topics.noneFollowed')}</span> : null}
              {followed.map((topic) => (
                <button key={topic.id} type="button" className="field-toggle" aria-pressed="true" onClick={() => toggle(topic)} title={t('topics.unfollow')}>
                  <span>{topic.label}</span>
                  <span className="field-toggle__code">×</span>
                </button>
              ))}
            </div>

            {GROUPS.map(({ origin, label: heading, hint }) => {
              const list = topics.filter((topic) => topic.origin === origin && !topic.followed);
              if (list.length === 0) return null;
              return (
                <div key={origin}>
                  <h3 className="topic-manager__group" title={t(hint)}>
                    {t(heading)}
                  </h3>
                  <div className="topic-manager__chips">
                    {list.map((topic) => (
                      <span key={topic.id} className="topic-manager__chip">
                        <button type="button" className="field-toggle" aria-pressed="false" onClick={() => toggle(topic)}>
                          <span>+ {topic.label}</span>
                        </button>
                        {origin === 'user' ? (
                          <button
                            type="button"
                            className="text-link text-link--quiet"
                            onClick={() => remove(topic)}
                            aria-label={t('topics.remove', { name: topic.label })}
                          >
                            {t('accounts.remove')}
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}

            <form
              className="topic-manager__add"
              onSubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t('topics.addPlaceholder')}
                aria-label={t('topics.addLabel')}
                maxLength={80}
              />
              <button type="submit" className="button" disabled={label.trim().length < 2}>
                {t('topics.add')}
              </button>
            </form>
          </>
        )}
        {error !== null ? <p className="settings__warn">{error}</p> : null}
        {changed ? <p className="settings__quiet">{t('topics.willGather')}</p> : null}
        <div className="confirm__actions">
          <button ref={doneRef} type="button" className="button" onClick={() => onClose(changed)}>
            {t('topics.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
