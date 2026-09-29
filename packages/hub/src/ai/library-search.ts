import type { PaperStore } from '../store/index';
export interface LibraryHit { paperKey: string; title: string; page: number; text: string }
export interface LibrarySearch { searchLibrary(query: string, limit?: number): Promise<LibraryHit[]> }
export class InMemoryLibrarySearch implements LibrarySearch {
  constructor(private readonly store: PaperStore) {}
  async searchLibrary(query: string, limit = 12): Promise<LibraryHit[]> {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const scored: { hit: LibraryHit; score: number }[] = [];
    for (const key of this.store.listPapers()) {
      const title = this.store.getPaper(key)?.title ?? key;
      for (const block of this.store.listBlocks(key)) {
        const text = block.sourceText.slice(0, 3000);
        const lower = `${title} ${text}`.toLowerCase();
        const score = words.reduce((n, word) => n + (lower.includes(word) ? 1 : 0), 0);
        if (score) scored.push({ hit: { paperKey: key, title, page: block.regions[0]?.page ?? 1, text }, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(v => v.hit);
  }
}
