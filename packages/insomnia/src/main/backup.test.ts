import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ default: { app: { getPath: () => os.tmpdir() } } }));

import { createBackup, getDataFolderInfo, listBackups } from './backup';

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

describe('getDataFolderInfo', () => {
  it('reports the folder and the size of the data files only', async () => {
    expect(await getDataFolderInfo()).toEqual({ path: dataPath, sizeBytes: 8 });
  });
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
