import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { aiSettingsSchema, type AiSettings } from '@fractal/shared';
import type { SettingsStore } from './provider';

export const DEFAULT_SETTINGS: AiSettings = { default: { provider: 'codex', model: 'gpt-6-sol' }, overrides: {} };
export class JsonSettingsStore implements SettingsStore {
  constructor(private readonly directory: string) {}
  async read(): Promise<AiSettings | null> {
    try { return aiSettingsSchema.parse(JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async write(value: AiSettings): Promise<void> {
    const validated = aiSettingsSchema.parse(value);
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, 'settings.json');
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(validated, null, 2), { flag: 'wx' });
    await rename(temp, file);
  }
}
