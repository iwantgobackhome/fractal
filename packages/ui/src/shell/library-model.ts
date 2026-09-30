import type { Folder, LibraryRecord, Paper } from '@fractal/shared';

export function folderSubtree(folders: Folder[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders)
      if (!folder.deleted && folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
  }
  return ids;
}

export function folderPath(folders: Folder[], id: string): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let folder = folders.find((item) => item.id === id);
  while (folder && !visited.has(folder.id)) {
    names.unshift(folder.name);
    visited.add(folder.id);
    folder = folders.find((item) => item.id === folder?.parentId);
  }
  return names.join(' / ') || id;
}

export function matchesRecord(record: LibraryRecord, query: string, folders: Folder[]): boolean {
  const text = [
    record.title,
    ...record.authors.map((author) => `${author.given} ${author.family}`),
    record.venue,
    record.doi,
    record.arxivId,
    ...record.tags,
    ...record.collections.map((id) => folderPath(folders, id)),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

export function cachedPaper(paper: Paper | undefined): boolean {
  return paper !== undefined && paper.pdfSha256 !== null;
}
