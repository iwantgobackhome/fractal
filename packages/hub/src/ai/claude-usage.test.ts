import { describe, expect, it, vi } from 'vitest';
import { classifyClaudeUsageScreen, parseClaudeUsageScreen, readClaudeUsageViaPty, resolveClaudePtyCommand } from './claude-usage';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Claude /usage screen', () => {
  it('recognizes a recorded workspace trust dialog before the real input prompt', () => {
    const cwd = 'C:\\Fractal Data\\claude-usage\\claude%3Asystem';
    const trust = `\r\n────────────────Accessingworkspace:${cwd}Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?(Likeyourowncode,awell-knownopensourceproject,orworkfromyourteam).Ifnot,takeamomenttoreviewwhat'sinthisfolderfirst.ClaudeCode'llbeabletoread,edit,andexecutefileshere.>No,exitYes,ItrustthisfolderEntertoconfirm·Esctocancel`;
    expect(classifyClaudeUsageScreen(trust, cwd)).toEqual({ kind: 'trust', selection: 'no' });
    expect(classifyClaudeUsageScreen(trust, 'C:\\Some Other Folder')).toEqual({ kind: 'other', title: 'Workspace safety check for another folder' });
    const prompt = `${trust}▐▛███▛█ClaudeCodev2.1.285\r\n> Try"writeatestfor<filepath>"\r\n⏵⏵automodeon·◐medium·/effort`;
    expect(classifyClaudeUsageScreen(prompt, cwd)).toEqual({ kind: 'ready' });
    expect(classifyClaudeUsageScreen('Select a theme for Claude Code', cwd)).toEqual({ kind: 'other', title: 'Select a theme for Claude Code' });
  });
  it('reads the ❯ selection marker Claude Code 2.1 draws (captured on Windows)', () => {
    const cwd = 'C:\\Users\\Home\\AppData\\Local\\Temp\\ptycwd3';
    const trust = `Accessing workspace:\n${cwd}\nQuick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source\nproject, or work from your team). If not, take a moment to review what's in this folder first.\nClaude Code'll be able to read, edit, and execute files here.\nSecurity guide\n❯ No, exit\nYes, I trust this folder\nEnter to confirm · Esc to cancel`;
    expect(classifyClaudeUsageScreen(trust, cwd)).toEqual({ kind: 'trust', selection: 'no' });
    expect(classifyClaudeUsageScreen(trust.replace('❯ No, exit\nYes', 'No, exit\n❯ Yes'), cwd)).toEqual({ kind: 'trust', selection: 'yes' });
    expect(classifyClaudeUsageScreen(trust.replace('❯ ', ''), cwd)).toEqual({ kind: 'trust', selection: 'unknown' });
    const prompt = `▐▛███▛█ Claude Code v2.1.285\n❯ Try "write a test for <filepath>"\n⏵⏵ auto mode on · ◐ medium · /effort`;
    expect(classifyClaudeUsageScreen(prompt, cwd)).toEqual({ kind: 'ready' });
  });
  it('reads both subscription windows and their local reset times', () => {
    const screen = '\x1b[2JCurrent session████20%usedResets3:50pm(Asia/Seoul)\nCurrent week (all models)████28%usedResetsOct 3, 10pm(Asia/Seoul)';
    expect(parseClaudeUsageScreen(screen, new Date('2026-09-30T00:00:00Z'))).toEqual({
      fiveHour: { usedPercent: 20, resetsAt: '2026-09-30T06:50:00.000Z' },
      weekly: { usedPercent: 28, resetsAt: '2026-10-03T13:00:00.000Z' },
    });
    expect(parseClaudeUsageScreen('No subscription windows')).toEqual({ fiveHour: null, weekly: null });
  });
  it('resolves the Windows CLI to an absolute executable from an inherited PATH', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fractal-claude-cli-'));
    try {
      const executable = join(directory, 'claude.exe');
      writeFileSync(executable, '');
      expect(resolveClaudePtyCommand({ Path: directory })).toEqual({ file: executable, args: [] });
      expect(() => resolveClaudePtyCommand({ Path: join(directory, 'missing') })).toThrow('not found on PATH');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('kills a running usage PTY as soon as shutdown aborts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fractal-usage-stop-'));
    const executable = join(root, 'claude.exe');
    writeFileSync(executable, '');
    const kill = vi.fn();
    const terminal = { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill };
    const spawn = vi.fn(() => terminal) as unknown as typeof import('@lydell/node-pty').spawn;
    const shutdown = new AbortController();
    try {
      const pending = readClaudeUsageViaPty({ Path: root }, root, 'claude:system', shutdown.signal, spawn);
      shutdown.abort();
      await expect(pending).rejects.toThrow('cancelled');
      expect(kill).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
