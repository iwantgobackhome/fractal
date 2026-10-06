import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { Folder, LibraryRecord, Paper } from '@fractal/shared';
import { locale, t, useLanguage } from '../i18n';
import { Selector } from '../components/Selector';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { paperStatusLabel } from '../lib/status';
import type { HubApi } from './hub-api';
import { Sidebar } from './Sidebar';
import type { ShellView } from './Masthead';
import { indexCopy } from './index-copy';
import { cachedPaper, folderPath, folderSubtree, matchesRecord } from './library-model';
import { PublicationActions, PublicationMeta } from './PublicationControls';

type Shelf = 'saved' | 'recent' | 'cached';
interface Props {
  papers: Paper[];
  query: string;
  onQueryChange(query: string): void;
  onOpen(paperKey: string): void;
  onRequestDelete(paperKey: string): void;
  onImport(): void;
  onNavigate(view: ShellView): void;
  hub: HubApi;
}
type FolderEdit = { id: string | null; name: string; parentId: string };

export function LibraryScreen({ papers, query, onQueryChange, onOpen, onRequestDelete, onImport, onNavigate, hub }: Props): JSX.Element {
  const language = useLanguage();
  const copy = indexCopy(language);
  const [records, setRecords] = useState<LibraryRecord[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [shelf, setShelf] = useState<Shelf>('saved');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState('newest');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<FolderEdit | null>(null);
  const [folderDelete, setFolderDelete] = useState<Folder | null>(null);
  const [editing, setEditing] = useState<LibraryRecord | null>(null);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [tagsText, setTagsText] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [next, tree] = await Promise.all([hub.library(), hub.folders()]);
      if (next === null || tree === null) throw new Error(indexCopy(language).unavailable);
      setRecords(next);
      setFolders(tree.filter((folder) => !folder.deleted));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : indexCopy(language).unavailable);
    } finally {
      setLoading(false);
    }
  }, [hub, language]);
  useEffect(() => {
    void load();
  }, [load, papers]);
  useEffect(() => {
    const changed = () => void load();
    window.addEventListener('fractal:catalog-changed', changed);
    return () => window.removeEventListener('fractal:catalog-changed', changed);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !pending && !editing && !folderEdit && !folderDelete) void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load, pending, editing, folderEdit, folderDelete]);
  const mutate = async (action: () => Promise<unknown>, close?: () => void) => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result === null) throw new Error(copy.mutationError);
      close?.();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.mutationError);
    } finally {
      setPending(false);
    }
  };
  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.paperKey, paper])), [papers]);
  const all = records ?? [];
  const counts = {
    saved: all.filter((record) => record.saved !== false).length,
    recent: all.filter((record) => record.lastReadAt).length,
    cached: all.filter((record) => cachedPaper(paperMap.get(record.paperKey))).length,
  };
  const descendants = folderId === null ? null : folderSubtree(folders, folderId);
  const shelfRecords = all.filter((record) =>
    descendants !== null
      ? record.collections.some((id) => descendants.has(id))
      : shelf === 'saved'
        ? record.saved !== false
        : shelf === 'recent'
          ? !!record.lastReadAt
          : cachedPaper(paperMap.get(record.paperKey)),
  );
  const visible = shelfRecords
    .filter((record) => matchesRecord(record, query, folders) && (status === 'all' || record.status === status) && (tag === '' || record.tags.includes(tag)))
    .sort((a, b) =>
      sort === 'title'
        ? (a.title ?? '').localeCompare(b.title ?? '', locale())
        : sort === 'oldest'
          ? a.addedAt.localeCompare(b.addedAt)
          : (b.lastReadAt ?? b.savedAt ?? b.addedAt).localeCompare(a.lastReadAt ?? a.savedAt ?? a.addedAt),
    );
  const title = folderId ? folderPath(folders, folderId) : copy[shelf];
  const filtered = query.trim() !== '' || status !== 'all' || tag !== '';
  const clear = () => {
    onQueryChange('');
    setStatus('all');
    setTag('');
  };
  const chooseShelf = (next: Shelf) => {
    setShelf(next);
    setFolderId(null);
  };
  const editRecord = (record: LibraryRecord) => {
    setEditing(record);
    setMemberships([...record.collections]);
    setTagsText(record.tags.join(', '));
    setError(null);
  };
  const date = (iso: string) => new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
  const renderFolders = (parentId: string | null, visited = new Set<string>()): JSX.Element[] =>
    folders
      .filter((folder) => (folder.parentId ?? null) === parentId && !visited.has(folder.id))
      .map((folder) => {
        const children = folders.some((child) => child.parentId === folder.id);
        const subtree = folderSubtree(folders, folder.id);
        const count = all.filter((record) => record.collections.some((id) => subtree.has(id))).length;
        const open = expanded.has(folder.id);
        return (
          <li key={folder.id} className="index-folder">
            <div className="index-folder__line">
              <button
                type="button"
                className="index-folder__disclosure"
                disabled={!children}
                aria-label={`${open ? copy.collapse : copy.expand}: ${folder.name}`}
                aria-expanded={children ? open : undefined}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (open) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  })
                }
              >
                {children ? (open ? '⌄' : '›') : '·'}
              </button>
              <button
                type="button"
                className="index-folder__name"
                aria-current={folderId === folder.id ? 'true' : undefined}
                onClick={() => setFolderId(folder.id)}
              >
                <span aria-hidden="true">▱</span>
                <span>{folder.name}</span>
                <small>{count}</small>
              </button>
              <button
                type="button"
                className="index-folder__menu"
                aria-label={`${copy.folderActions}: ${folder.name}`}
                aria-expanded={folderMenu === folder.id}
                onClick={() => setFolderMenu(folderMenu === folder.id ? null : folder.id)}
              >
                ⋯
              </button>
            </div>
            {folderMenu === folder.id ? (
              <div
                className="index-folder__actions"
                role="group"
                aria-label={copy.folderActions}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setFolderMenu(null);
                    (event.currentTarget.previousElementSibling?.lastElementChild as HTMLElement)?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setFolderEdit({ id: null, name: '', parentId: folder.id });
                    setFolderMenu(null);
                  }}
                >
                  {copy.childFolder}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFolderEdit({ id: folder.id, name: folder.name, parentId: folder.parentId ?? '' });
                    setFolderMenu(null);
                  }}
                >
                  {copy.editFolder}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFolderDelete(folder);
                    setFolderMenu(null);
                  }}
                >
                  {copy.deleteFolder}
                </button>
              </div>
            ) : null}
            {children && open ? <ul>{renderFolders(folder.id, new Set([...visited, folder.id]))}</ul> : null}
          </li>
        );
      });
  const unavailableParents = folderEdit?.id ? folderSubtree(folders, folderEdit.id) : new Set<string>();
  return (
    <main className="screen research-index" aria-labelledby="library-title">
      <Sidebar view="library" onNavigate={onNavigate}>
        <div className="index-sidebar-heading">
          <h2>{copy.folders}</h2>
          <button type="button" aria-label={copy.newFolder} onClick={() => setFolderEdit({ id: null, name: '', parentId: folderId ?? '' })}>
            +
          </button>
        </div>
        {folders.length === 0 ? <p className="index-sidebar-empty">{copy.folderEmpty}</p> : <ul className="index-folder-tree">{renderFolders(null)}</ul>}
        <div className="index-sidebar-export">
          <h2>{t('library.export')}</h2>
          <a
            href={hub.exportUrl(
              'bibtex',
              all.filter((record) => record.saved !== false).map((record) => record.paperKey),
            )}
            download="fractal-library.bib"
          >
            BibTeX
          </a>
          <a
            href={hub.exportUrl(
              'csl-json',
              all.filter((record) => record.saved !== false).map((record) => record.paperKey),
            )}
            download="fractal-library.json"
          >
            CSL-JSON
          </a>
        </div>
      </Sidebar>
      <section className="research-index__body">
        <div className="research-index__heading">
          <div>
            <p className="index-eyebrow">{copy.title}</p>
            <h1 id="library-title">{title}</h1>
            <p>{copy.deck}</p>
          </div>
          <button type="button" className="index-import" onClick={onImport}>
            ＋ {copy.import}
          </button>
        </div>
        <div className="index-summary">
          <span>
            <strong>{shelfRecords.length}</strong> {copy.papers}
          </span>
          <span>
            {copy.reading} <strong>{shelfRecords.filter((record) => record.status === 'reading').length}</strong>
          </span>
          {filtered ? (
            <span>
              {visible.length} {copy.shown}
            </span>
          ) : null}
        </div>
        <div className="index-tools">
          <div className="index-tabs" role="group" aria-label={t('library.shelves')}>
            {(['saved', 'recent', 'cached'] as const).map((id) => (
              <button type="button" key={id} aria-pressed={folderId === null && shelf === id} onClick={() => chooseShelf(id)}>
                {copy[id]} <small>{counts[id]}</small>
              </button>
            ))}
          </div>
          <Selector
            label={copy.sort}
            value={sort}
            onChange={setSort}
            options={[
              { value: 'newest', label: copy.newest },
              { value: 'title', label: copy.alphabetical },
              { value: 'oldest', label: copy.oldest },
            ]}
          />
        </div>
        <div className="index-filters">
          <label className="index-search">
            <span className="sr-only">{copy.search}</span>
            <input type="search" value={query} placeholder={copy.search} onChange={(event) => onQueryChange(event.target.value)} />
          </label>
          <Selector
            label={copy.filter}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: copy.anyStatus },
              { value: 'unread', label: copy.unread },
              { value: 'reading', label: copy.reading },
              { value: 'read', label: copy.readStatus },
            ]}
          />
          <Selector
            label={copy.tags}
            value={tag}
            onChange={setTag}
            options={[
              { value: '', label: copy.allTags },
              ...[...new Set(all.flatMap((record) => record.tags))].sort().map((value) => ({ value, label: value })),
            ]}
          />
          {filtered ? (
            <button type="button" className="text-link" onClick={clear}>
              {copy.clear}
            </button>
          ) : null}
        </div>
        {error && !editing && !folderEdit && !folderDelete ? (
          <div className="index-state index-state--error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {copy.retry}
            </button>
          </div>
        ) : null}
        {loading && records === null ? (
          <div className="index-state" role="status">
            <h2>{copy.loading}</h2>
            <p>{copy.emptyDeck}</p>
            <button type="button" onClick={onImport}>
              {copy.import}
            </button>
          </div>
        ) : records !== null && visible.length === 0 ? (
          <div className="index-state">
            <h2>
              {filtered
                ? copy.noMatch
                : folderId
                  ? copy.emptyFolder
                  : shelf === 'saved'
                    ? copy.emptySaved
                    : shelf === 'recent'
                      ? copy.emptyRecent
                      : copy.emptyCached}
            </h2>
            <p>{copy.emptyDeck}</p>
            <div>
              {filtered ? (
                <button type="button" onClick={clear}>
                  {copy.clear}
                </button>
              ) : (
                <button type="button" className="index-import" onClick={onImport}>
                  {copy.import}
                </button>
              )}
              {counts.cached > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    chooseShelf('cached');
                  }}
                >
                  {copy.showCached}
                </button>
              ) : null}
              {counts.saved > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    chooseShelf('saved');
                  }}
                >
                  {copy.showSaved}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <ol className="research-list" aria-busy={loading || undefined}>
            {visible.map((record, index) => {
              const paper = paperMap.get(record.paperKey);
              const cached = cachedPaper(paper);
              const progress = record.readProgress;
              const title = record.title?.trim() || paper?.title?.trim() || record.arxivId || t('paper.untitled');
              const open = () => {
                if (paper) onOpen(record.paperKey);
              };
              return (
                <li className="research-entry" key={record.paperKey} data-paper-key={record.paperKey}>
                  <span className="entry-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="research-entry__body">
                    <div className="entry-publication">
                      <span>{record.venue || (record.arxivId ? 'arXiv' : copy.publicationUnknown)}</span>
                      {record.year !== null ? <span>{record.year}</span> : null}
                      {paper?.pageCount ? <span>{t('paper.pages', { count: paper.pageCount })}</span> : null}
                      {record.doi ? <span>DOI {record.doi}</span> : null}
                    </div>
                    {record.publication ? <PublicationMeta publication={record.publication} source={record.publication.sources?.join(',')} /> : null}
                    {paper ? (
                      <button type="button" className="research-title" onClick={open}>
                        {title}
                      </button>
                    ) : (
                      <h2 className="research-title">{title}</h2>
                    )}
                    <p className="research-authors">
                      {record.authors.length
                        ? record.authors.map((author) => `${author.given} ${author.family}`.trim()).join(', ')
                        : paper?.authors.length
                          ? paper.authors.join(', ')
                          : copy.authorsUnknown}
                    </p>
                    {record.abstract ? <p className="research-summary">{record.abstract}</p> : null}
                    <div className="research-tags">
                      {record.tags.map((value) => (
                        <button type="button" key={value} onClick={() => setTag(value)}>
                          #{value}
                        </button>
                      ))}
                      {record.collections.map((id) => (
                        <button type="button" key={id} className="research-folder-tag" onClick={() => setFolderId(id)}>
                          {folderPath(folders, id)}
                        </button>
                      ))}
                    </div>
                    {record.lastReadAt ? (
                      <p className="research-last-read">
                        {copy.recent} · {date(record.lastReadAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="entry-status">
                    <button
                      type="button"
                      className="entry-save"
                      disabled={pending}
                      title={record.saved !== false ? copy.retained : undefined}
                      onClick={() => void mutate(() => hub.patchLibrary(record.paperKey, { saved: record.saved === false }))}
                    >
                      <span aria-hidden="true">{record.saved !== false ? '▣' : '▢'}</span> {record.saved !== false ? copy.unsave : copy.save}
                    </button>
                    {progress ? (
                      <div className="entry-progress">
                        <span>
                          {copy.page} {progress.page}
                          {paper?.pageCount ? ` / ${paper.pageCount}` : ''}
                          {progress.fraction !== undefined ? ` · ${Math.round(progress.fraction * 100)}%` : ''}
                        </span>
                        {progress.fraction !== undefined ? <progress aria-label={copy.progress} value={progress.fraction} max={1} /> : null}
                      </div>
                    ) : (
                      <span className="entry-quiet">{copy.unknownProgress}</span>
                    )}
                    <span className="entry-quiet">
                      {paper ? paperStatusLabel(paper) : copy.metadataOnly}
                      {cached ? ` · ${copy.cached}` : ''}
                    </span>
                    {paper ? (
                      <button type="button" className="entry-read" onClick={open}>
                        {progress ? copy.resume : copy.read}
                      </button>
                    ) : record.url && /^https:\/\//i.test(record.url) ? (
                      <PublicationActions
                        hub={hub}
                        record={record}
                        showSave={false}
                        hasPdf={false}
                        onOpen={onOpen}
                        item={{
                          title,
                          authors: record.authors.map((a) => `${a.given} ${a.family}`.trim()),
                          url: record.url,
                          doi: record.doi,
                          arxivId: record.arxivId,
                          abstract: record.abstract,
                          publication: record.publication,
                        }}
                      />
                    ) : null}
                    <button type="button" className="entry-organize" onClick={() => editRecord(record)}>
                      {copy.organize}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <footer className="index-footer">
          News Papers <span>·</span> {visible.length} / {shelfRecords.length} {copy.papers}
        </footer>
      </section>
      {folderEdit ? (
        <ConfirmDialog
          title={folderEdit.id ? copy.editFolder : copy.newFolder}
          confirmLabel={copy.done}
          confirmDisabled={pending || !folderEdit.name.trim()}
          onCancel={() => {
            if (!pending) {
              setFolderEdit(null);
              setError(null);
            }
          }}
          onConfirm={() =>
            void mutate(
              () =>
                folderEdit.id
                  ? hub.patchFolder(folderEdit.id, { name: folderEdit.name.trim(), parentId: folderEdit.parentId || null })
                  : hub.createFolder(folderEdit.name.trim(), folderEdit.parentId || null),
              () => {
                if (folderEdit.parentId) setExpanded((old) => new Set([...old, folderEdit.parentId]));
                setFolderEdit(null);
              },
            )
          }
        >
          <label className="index-dialog-field">
            {copy.folderName}
            <input autoFocus value={folderEdit.name} disabled={pending} onChange={(event) => setFolderEdit({ ...folderEdit, name: event.target.value })} />
          </label>
          <label className="index-dialog-field" htmlFor="folder-parent">
            {copy.parent}
          </label>
          <Selector
            id="folder-parent"
            label={copy.parent}
            value={folderEdit.parentId}
            disabled={pending}
            onChange={(parentId) => setFolderEdit({ ...folderEdit, parentId })}
            options={[
              { value: '', label: copy.root },
              ...folders.filter((folder) => !unavailableParents.has(folder.id)).map((folder) => ({ value: folder.id, label: folderPath(folders, folder.id) })),
            ]}
          />
          {error ? <p role="alert">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
      {folderDelete ? (
        <ConfirmDialog
          title={`${copy.deleteFolder}: ${folderDelete.name}`}
          confirmLabel={copy.deleteFolder}
          confirmDisabled={pending}
          danger
          onCancel={() => {
            if (!pending) {
              setFolderDelete(null);
              setError(null);
            }
          }}
          onConfirm={() =>
            void mutate(
              () => hub.deleteFolder(folderDelete.id),
              () => {
                if (folderId === folderDelete.id) setFolderId(null);
                setFolderDelete(null);
              },
            )
          }
        >
          <p>{copy.deleteFolderBody}</p>
          {error ? <p role="alert">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
      {editing ? (
        <ConfirmDialog
          title={copy.edit}
          confirmLabel={copy.done}
          confirmDisabled={pending}
          onCancel={() => {
            if (!pending) {
              setEditing(null);
              setError(null);
            }
          }}
          onConfirm={() =>
            void mutate(
              () =>
                hub.patchLibrary(editing.paperKey, {
                  collections: memberships,
                  tags: [
                    ...new Set(
                      tagsText
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    ),
                  ],
                }),
              () => setEditing(null),
            )
          }
        >
          <p className="confirm__subject">{editing.title}</p>
          <p>{copy.memberships}</p>
          <div className="index-memberships">
            {folders.map((folder) => (
              <label key={folder.id}>
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={memberships.includes(folder.id)}
                  onChange={(event) => setMemberships(event.target.checked ? [...memberships, folder.id] : memberships.filter((id) => id !== folder.id))}
                />
                <span>{folderPath(folders, folder.id)}</span>
              </label>
            ))}
          </div>
          <label className="index-dialog-field">
            {copy.tags}
            <input value={tagsText} disabled={pending} onChange={(event) => setTagsText(event.target.value)} />
          </label>
          <small>{copy.tagHint}</small>
          <p className="entry-quiet">{copy.retained}</p>
          {paperMap.has(editing.paperKey) ? (
            <button
              type="button"
              className="text-link index-destructive"
              disabled={pending}
              onClick={() => {
                const key = editing.paperKey;
                setEditing(null);
                onRequestDelete(key);
              }}
            >
              {copy.deletePaper}
            </button>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
