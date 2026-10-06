import type { Collection, HistoryEntry, LibraryRecord } from '@fractal/shared';
import { collectionSchema, historyEntrySchema } from '@fractal/shared';
import type { SqlitePaperStore } from './sqlite';
import { invalidInput, notFound } from './errors';

type Row = Record<string, unknown>;
export function atomic<T>(store: SqlitePaperStore, work: () => T): T {
  store.db.exec('SAVEPOINT foundation');
  try {
    const result = work();
    store.db.exec('RELEASE foundation');
    return result;
  } catch (error) {
    store.db.exec('ROLLBACK TO foundation; RELEASE foundation');
    throw error;
  }
}
export function change(store: SqlitePaperStore, kind: string, id: string): void {
  store.db.prepare('INSERT INTO changes(kind,item_key) VALUES(?,?)').run(kind, id);
}
export function timestamp(previous?: string): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}
export function migrateFoundation(store: SqlitePaperStore): void {
  if (store.db.prepare('SELECT 1 FROM migrations WHERE version=11').get()) return;
  atomic(store, () => {
    store.db.exec(`ALTER TABLE collections ADD COLUMN data TEXT;
      CREATE TABLE history(id TEXT PRIMARY KEY, paper_key TEXT, request_key TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE mutation_receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);`);
    for (const row of store.db.prepare('SELECT paper_key,data FROM bibliography').all() as Row[]) {
      const old = JSON.parse(String(row.data)) as LibraryRecord;
      const record = { ...old, saved: true, savedAt: old.addedAt, lastReadAt: null, readProgress: null, rev: 1, deviceId: 'hub' };
      store.db.prepare('UPDATE bibliography SET data=? WHERE paper_key=?').run(JSON.stringify(record), String(row.paper_key));
      change(store, 'paper', record.paperKey);
    }
    for (const row of store.db.prepare('SELECT id,name FROM collections').all() as Row[]) {
      const folder: Collection = {
        id: String(row.id),
        name: String(row.name),
        parentId: null,
        rev: 1,
        updatedAt: timestamp(),
        deleted: false,
        deviceId: 'hub',
      };
      store.db.prepare('UPDATE collections SET data=? WHERE id=?').run(JSON.stringify(folder), folder.id);
      change(store, 'folder', folder.id);
    }
    for (const row of store.db.prepare('SELECT paper_key,data FROM conversations').all() as Row[]) {
      const conversation = JSON.parse(String(row.data)) as import('./validate').ConversationRecord;
      mirrorConversation(store, String(row.paper_key), conversation);
    }
    store.db.prepare("INSERT INTO migrations VALUES(11,datetime('now'))").run();
  });
}
export function getFolder(store: SqlitePaperStore, id: string): Collection | null {
  const row = store.db.prepare('SELECT data FROM collections WHERE id=?').get(id) as Row | undefined;
  return row?.data ? collectionSchema.parse(JSON.parse(String(row.data))) : null;
}
export function listFolders(store: SqlitePaperStore, tombstones = false): Collection[] {
  return (store.db.prepare('SELECT data FROM collections ORDER BY name,id').all() as Row[])
    .filter((r) => r.data)
    .map((r) => collectionSchema.parse(JSON.parse(String(r.data))))
    .filter((r) => tombstones || !r.deleted);
}
export function putFolder(store: SqlitePaperStore, input: Pick<Collection, 'id' | 'name' | 'parentId'>, deviceId = 'hub'): Collection {
  return atomic(store, () => {
    const parsed = collectionSchema.parse(input);
    const old = getFolder(store, parsed.id);
    if (old?.deleted) throw invalidInput('A deleted folder ID cannot be reused');
    const parentId = parsed.parentId === undefined ? (old?.parentId ?? null) : parsed.parentId;
    let ancestor = parentId;
    const seen = new Set([parsed.id]);
    while (ancestor !== null) {
      if (seen.has(ancestor)) throw invalidInput('Folder parent would create a cycle');
      seen.add(ancestor);
      const parent = getFolder(store, ancestor);
      if (!parent || parent.deleted) throw notFound('Parent folder not found');
      ancestor = parent.parentId ?? null;
    }
    const next: Collection = { ...parsed, parentId, deleted: false, rev: (old?.rev ?? 0) + 1, updatedAt: timestamp(old?.updatedAt), deviceId };
    store.db
      .prepare('INSERT INTO collections(id,name,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data')
      .run(next.id, next.name, JSON.stringify(next));
    change(store, 'folder', next.id);
    return next;
  });
}
export function deleteFolder(store: SqlitePaperStore, id: string, deviceId = 'hub'): Collection {
  return atomic(store, () => {
    const old = getFolder(store, id);
    if (!old) throw notFound('Folder not found');
    if (old.deleted) return old;
    for (const child of listFolders(store)) if (child.parentId === id) putFolder(store, { ...child, parentId: old.parentId ?? null }, deviceId);
    for (const paper of store.listLibrary())
      if (paper.collections.includes(id)) store.patchLibrary(paper.paperKey, { collections: paper.collections.filter((c) => c !== id) }, deviceId);
    const next = { ...old, deleted: true, rev: (old.rev ?? 0) + 1, updatedAt: timestamp(old.updatedAt), deviceId };
    store.db.prepare('UPDATE collections SET data=? WHERE id=?').run(JSON.stringify(next), id);
    change(store, 'folder', id);
    return next;
  });
}
export function getHistory(store: SqlitePaperStore, id: string): HistoryEntry | null {
  const row = store.db.prepare('SELECT data FROM history WHERE id=?').get(id) as Row | undefined;
  return row ? historyEntrySchema.parse(JSON.parse(String(row.data))) : null;
}
export function listHistory(store: SqlitePaperStore, paperKey?: string | null, tombstones = false): HistoryEntry[] {
  const rows =
    paperKey === undefined
      ? store.db.prepare('SELECT data FROM history').all()
      : store.db.prepare('SELECT data FROM history WHERE paper_key IS ?').all(paperKey);
  return (rows as Row[])
    .map((r) => historyEntrySchema.parse(JSON.parse(String(r.data))))
    .filter((r) => tombstones || !r.deleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function putHistory(store: SqlitePaperStore, input: HistoryEntry): HistoryEntry {
  return atomic(store, () => {
    const checked = historyEntrySchema.parse(input);
    const old = getHistory(store, checked.id);
    if (old && (old.paperKey !== checked.paperKey || old.kind !== checked.kind || old.requestId !== checked.requestId))
      throw invalidInput('History identity cannot change');
    if (old?.deleted) return old;
    // Placement has its own clock: imports and generation updates must not undo a newer card move.
    // Equal timestamps favor the incoming placement; omission preserves the stored placement.
    const placement =
      old?.placement && (!checked.placement || Date.parse(old.placement.updatedAt) > Date.parse(checked.placement.updatedAt))
        ? old.placement
        : checked.placement;
    const next = {
      ...checked,
      ...(placement ? { placement } : {}),
      createdAt: old?.createdAt ?? checked.createdAt,
      rev: (old?.rev ?? 0) + 1,
      updatedAt: timestamp(old?.updatedAt),
    };
    if (next.conversation && (next.status === 'canceled' || next.status === 'failed')) {
      next.conversation.messages = next.conversation.messages.map((message) =>
        message.role === 'assistant' && message.status === 'answering'
          ? { ...message, status: next.status as 'canceled' | 'failed', error: next.status === 'failed' ? next.error : null }
          : message,
      );
    }
    const requestKey = next.requestId === null ? null : JSON.stringify([next.paperKey, next.kind, next.requestId]);
    store.db
      .prepare('INSERT INTO history VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(next.id, next.paperKey, requestKey, JSON.stringify(next));
    change(store, 'history', next.id);
    return next;
  });
}
export function mirrorConversation(store: SqlitePaperStore, key: string, conversation: import('./validate').ConversationRecord): void {
  const id = `chat:${key}:${conversation.conversationId}`;
  const old = getHistory(store, id);
  const last = conversation.messages.at(-1);
  const status = last?.role === 'user' ? 'running' : last?.status === 'answering' ? 'running' : (last?.status ?? 'completed');
  putHistory(store, {
    id,
    paperKey: key,
    kind: 'conversation',
    question: conversation.messages.find((m) => m.role === 'user')?.text ?? '',
    text: last?.role === 'assistant' ? last.text : '',
    status,
    createdAt: old?.createdAt ?? conversation.messages[0]?.createdAt ?? timestamp(),
    updatedAt: timestamp(),
    completedAt: status === 'running' ? null : timestamp(),
    requestId: null,
    context: {},
    answer: null,
    error: last?.error ?? null,
    conversation,
    rev: 0,
    deleted: false,
    deviceId: 'hub',
  });
}
