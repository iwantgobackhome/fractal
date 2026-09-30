import { createHash } from 'node:crypto';
import type { SyncPush, SyncPushResult } from '@fractal/shared';
import { invalidInput } from './errors';
import { atomic } from './foundation';
import type { SqlitePaperStore } from './sqlite';

type Result = NonNullable<SyncPushResult['metadataResults']>[number];
function apply(store: SqlitePaperStore, kind: Result['kind'], id: string, deviceId: string, requestId: string, input: unknown, work: () => Result): Result {
  // Scope to device + request ID across entity kinds; retries cannot mutate a different entity.
  const key = JSON.stringify([deviceId, requestId]);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([kind, id, input]))
    .digest('hex');
  return atomic(store, () => {
    const receipt = store.db.prepare('SELECT fingerprint,data FROM mutation_receipts WHERE id=?').get(key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw invalidInput('requestId was reused with different mutation data');
      return JSON.parse(String(receipt.data)) as Result;
    }
    const result = work();
    store.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?)').run(key, fingerprint, JSON.stringify(result));
    return result;
  });
}
export function pushMetadata(store: SqlitePaperStore, input: SyncPush): Result[] {
  const results: Result[] = [];
  // Folders precede papers so membership in folders created in this batch is valid.
  for (const mutation of input.folders ?? [])
    results.push(
      apply(store, 'folder', mutation.id, mutation.deviceId, mutation.requestId, mutation, () => {
        const old = store.getFolder(mutation.id);
        if ((old?.rev ?? 0) !== mutation.baseRev || old?.deleted || (!old && mutation.deleted))
          return { kind: 'folder', id: mutation.id, applied: false, conflict: true, rev: old?.rev ?? 0, current: old };
        const current = mutation.deleted
          ? store.deleteFolder(mutation.id, mutation.deviceId)
          : store.putFolder(
              {
                id: mutation.id,
                name: mutation.patch.name ?? old?.name ?? '',
                parentId: mutation.patch.parentId === undefined ? old?.parentId : mutation.patch.parentId,
              },
              mutation.deviceId,
            );
        return { kind: 'folder', id: mutation.id, applied: true, conflict: false, rev: current.rev!, current };
      }),
    );
  for (const mutation of input.papers ?? [])
    results.push(
      apply(store, 'paper', mutation.paperKey, mutation.deviceId, mutation.requestId, mutation, () => {
        const old = store.getLibrary(mutation.paperKey);
        if (!old || (old.rev ?? 0) !== mutation.baseRev)
          return { kind: 'paper', id: mutation.paperKey, applied: false, conflict: true, rev: old?.rev ?? 0, current: old };
        const current = store.patchLibrary(mutation.paperKey, mutation.patch, mutation.deviceId);
        return { kind: 'paper', id: mutation.paperKey, applied: true, conflict: false, rev: current.rev!, current };
      }),
    );
  for (const mutation of input.history ?? [])
    results.push(
      apply(store, 'history', mutation.entry.id, mutation.entry.deviceId, mutation.requestId, mutation, () => {
        const old = store.getHistory(mutation.entry.id);
        if ((old?.rev ?? 0) !== mutation.baseRev || old?.deleted || (old && ['pending', 'running'].includes(old.status)))
          return { kind: 'history', id: mutation.entry.id, applied: false, conflict: true, rev: old?.rev ?? 0, current: old };
        if (['pending', 'running'].includes(mutation.entry.status)) throw invalidInput('Offline history imports must be settled');
        if (mutation.entry.kind === 'conversation') throw invalidInput('Legacy conversation history is owned by /chat');
        const current = store.putHistory({ ...mutation.entry, createdAt: old?.createdAt ?? mutation.entry.createdAt });
        return { kind: 'history', id: current.id, applied: true, conflict: false, rev: current.rev, current };
      }),
    );
  return results;
}
