import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRecord } from '@fractal/shared';
export interface UsageStore { read(): Promise<UsageRecord[]>; write(rows: UsageRecord[]): Promise<void> }
export class JsonUsageStore implements UsageStore {
  constructor(private readonly directory: string) {}
  async read(): Promise<UsageRecord[]> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.directory, 'ai-usage.json'), 'utf8'));
      return Array.isArray(value) ? value.filter(v => v && typeof v.day === 'string' && (v.provider === 'codex' || v.provider === 'claude') && typeof v.model === 'string' && Number.isInteger(v.requests)) : [];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async write(rows: UsageRecord[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, 'ai-usage.json'); const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(rows), { flag: 'wx' }); await rename(temporary, target);
  }
}
