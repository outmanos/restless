import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ default: { app: { getPath: () => os.tmpdir() } } }));

import { backupPreferences, createBackup, listBackups, pruneBackups } from './backup';

let dataPath: string;

beforeEach(() => {
  dataPath = mkdtempSync(path.join(os.tmpdir(), 'restless-backup-'));
  process.env['INSOMNIA_DATA_PATH'] = dataPath;
  writeFileSync(path.join(dataPath, 'insomnia.Request.db'), 'abc');
  writeFileSync(path.join(dataPath, 'insomnia.Workspace.db'), 'defgh');
  writeFileSync(path.join(dataPath, 'settings.json'), 'not a data file');
});

afterEach(() => {
  delete process.env['INSOMNIA_DATA_PATH'];
});

describe('createBackup and listBackups', () => {
  it('lists nothing before any backup exists', async () => {
    expect(await listBackups()).toEqual([]);
  });

  it('copies the data files into a named folder and lists it', async () => {
    const made = await createBackup(new Date('2026-11-07T10:20:30Z'));
    expect(made.name).toMatch(/-2026-11-07-10-20-30$/);
    expect(made.files).toBe(2);
    expect(readdirSync(path.join(dataPath, 'backups', made.name)).sort()).toEqual([
      'insomnia.Request.db',
      'insomnia.Workspace.db',
    ]);
    const listed = await listBackups();
    expect(listed.map(backup => backup.name)).toEqual([made.name]);
    expect(listed[0].sizeBytes).toBe(8);
  });

  it('lists the newest first and skips folders with no data files', async () => {
    mkdirSync(path.join(dataPath, 'backups', 'empty'), { recursive: true });
    await createBackup(new Date('2026-11-07T10:00:00Z'));
    await new Promise(resolve => setTimeout(resolve, 15));
    const second = await createBackup(new Date('2026-11-07T11:00:00Z'));
    const names = (await listBackups()).map(backup => backup.name);
    expect(names[0]).toBe(second.name);
    expect(names).not.toContain('empty');
  });
});

describe('pruneBackups', () => {
  const make = async (hour: number) => {
    const made = await createBackup(new Date(`2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`));
    await new Promise(resolve => setTimeout(resolve, 15));
    return made.name;
  };

  it('keeps the newest and deletes the rest', async () => {
    const names = [await make(1), await make(2), await make(3), await make(4)];
    const removed = await pruneBackups(2);
    expect(removed.sort()).toEqual([names[0], names[1]].sort());
    expect((await listBackups()).map(backup => backup.name).sort()).toEqual([names[2], names[3]].sort());
  });

  it('never keeps fewer than one', async () => {
    await make(1);
    await make(2);
    await pruneBackups(0);
    expect(await listBackups()).toHaveLength(1);
  });

  it('keeps the one being restored even if it is the oldest', async () => {
    const names = [await make(1), await make(2), await make(3)];
    await pruneBackups(2, names[0]);
    const left = (await listBackups()).map(backup => backup.name);
    expect(left).toContain(names[0]);
    expect(left).toHaveLength(2);
  });
});

describe('backupPreferences', () => {
  it('saves the preferences in the backups folder and prunes old copies', async () => {
    const first = await backupPreferences('{"a":1}', 2, new Date('2026-11-07T01:00:00Z'));
    await backupPreferences('{"a":2}', 2, new Date('2026-11-07T02:00:00Z'));
    await backupPreferences('{"a":3}', 2, new Date('2026-11-07T03:00:00Z'));
    const folder = path.dirname(first);
    expect(readdirSync(folder).sort()).toEqual([
      'preferences-2026-11-07-02-00-00.json',
      'preferences-2026-11-07-03-00-00.json',
    ]);
  });

  it('does not show up as a data backup', async () => {
    await backupPreferences('{}', 5);
    expect(await listBackups()).toEqual([]);
  });
});
