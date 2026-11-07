import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import electron from 'electron';

import { version } from '../../package.json';
import { assertPathWithinDir } from './safe-fs-write';

export async function backup() {
  try {
    const dataPath = process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');
    const versionPath = path.join(dataPath, 'backups', version);
    await mkdir(versionPath, { recursive: true });
    // skip if backup already exists at version path
    const backupFiles = await readdir(versionPath);
    if (backupFiles.length) {
      console.log('[main] Backup found at:', versionPath);
      return;
    }
    const files = await readdir(dataPath);
    for (const file of files) {
      if (file.endsWith('.db')) {
        await copyFile(path.join(dataPath, file), path.join(versionPath, file));
      }
    }

    console.log('[main] Exported backup to:', versionPath);
  } catch (err) {
    console.log('[main] Error exporting backup:', err);
  }
}

export async function restoreBackup(version: string, keep?: number) {
  try {
    const dataPath = process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');
    const backupsDir = path.join(dataPath, 'backups');
    const versionPath = path.join(backupsDir, version);

    // `version` is renderer-supplied over IPC — a traversal sequence here
    // (e.g. `../../../../some/dir`) must never let this read/copy `.db`
    // files from outside the app's own backups directory.
    await assertPathWithinDir(backupsDir, versionPath);

    const files = await readdir(versionPath);
    if (!files.length) {
      console.log('[main] No backup found at:', versionPath);
      return;
    }
    // Keep what is there now, so a restore can be undone
    await createBackup(new Date(), 'before-restore');
    if (keep) {
      await pruneBackups(keep, version);
    }
    await Promise.all(
      files
        .filter(file => file.endsWith('.db'))
        .map(file => copyFile(path.join(versionPath, file), path.join(dataPath, file))),
    );
    console.log('[main] Restored backup from:', versionPath);
  } catch (err) {
    console.log('[main] Error restoring backup:', err);
  }
  electron.app.relaunch();
  electron.app.exit();
}

const getDataPath = () => process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');

export const getDataFolder = getDataPath;
export const getBackupsFolder = () => path.join(getDataPath(), 'backups');

export interface BackupInfo {
  // The folder name, which is what restoreBackup takes
  name: string;
  // When the backup was made
  createdAt: number;
  // How many data files it holds
  files: number;
  sizeBytes: number;
}

const dbFiles = async (folder: string) => (await readdir(folder)).filter(file => file.endsWith('.db'));

const sizeOf = async (folder: string, files: string[]) => {
  const sizes = await Promise.all(files.map(async file => (await stat(path.join(folder, file))).size));
  return sizes.reduce((total, size) => total + size, 0);
};

// What is in the backups folder, newest first
export async function listBackups(): Promise<BackupInfo[]> {
  const backupsDir = path.join(getDataPath(), 'backups');
  let names: string[] = [];
  try {
    names = await readdir(backupsDir);
  } catch {
    return [];
  }
  const backups = await Promise.all(
    names.map(async (name): Promise<BackupInfo | null> => {
      try {
        const folder = path.join(backupsDir, name);
        const info = await stat(folder);
        if (!info.isDirectory()) {
          return null;
        }
        const files = await dbFiles(folder);
        return { name, createdAt: info.mtimeMs, files: files.length, sizeBytes: await sizeOf(folder, files) };
      } catch {
        return null;
      }
    }),
  );
  return backups
    .filter((backup): backup is BackupInfo => backup !== null && backup.files > 0)
    .sort((a, b) => b.createdAt - a.createdAt);
}

const timestamp = (date: Date) => date.toISOString().replace(/[:T]/g, '-').slice(0, 19);

// A backup the person asked for. Unlike the one made on each update, there can be many.
export async function createBackup(now = new Date(), prefix: string = version): Promise<BackupInfo> {
  const dataPath = getDataPath();
  const name = `${prefix}-${timestamp(now)}`;
  const folder = path.join(dataPath, 'backups', name);
  await mkdir(folder, { recursive: true });
  const files = await dbFiles(dataPath);
  for (const file of files) {
    await copyFile(path.join(dataPath, file), path.join(folder, file));
  }
  return { name, createdAt: Date.now(), files: files.length, sizeBytes: await sizeOf(folder, files) };
}

const PREFERENCES_BACKUP_FOLDER = 'preferences';

// Deletes the oldest backups beyond the newest `keep`. `protect` is one that must stay, such as the one being restored.
export async function pruneBackups(keep: number, protect?: string): Promise<string[]> {
  const limit = Math.max(1, Math.floor(keep));
  const backupsDir = getBackupsFolder();
  const removed: string[] = [];
  const kept = (await listBackups()).filter(backup => backup.name !== protect);
  for (const backup of kept.slice(Math.max(0, limit - (protect ? 1 : 0)))) {
    await rm(path.join(backupsDir, backup.name), { recursive: true, force: true });
    removed.push(backup.name);
  }
  // The copies of preferences made before an import are kept to the same number
  try {
    const folder = path.join(backupsDir, PREFERENCES_BACKUP_FOLDER);
    const files = (await readdir(folder))
      .filter(file => file.endsWith('.json'))
      .sort()
      .reverse();
    for (const file of files.slice(limit)) {
      await rm(path.join(folder, file), { force: true });
    }
  } catch {
    // No preferences were backed up yet
  }
  return removed;
}

// The preferences as they are right now, saved before an import replaces them
export async function backupPreferences(json: string, keep: number, now = new Date()): Promise<string> {
  const folder = path.join(getBackupsFolder(), PREFERENCES_BACKUP_FOLDER);
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `preferences-${timestamp(now)}.json`);
  await writeFile(file, json);
  await pruneBackups(keep);
  return file;
}
