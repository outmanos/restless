import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import electron from 'electron';

import { version } from '../../package.json';
import { assertPathWithinDir } from './safe-fs-write';

export async function backup() {
  try {
    const dataPath = getDataPath();
    const versionPath = path.join(getBackupsFolder(), version);
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
  const dataPath = getDataPath();
  const backupsDir = getBackupsFolder();
  const versionPath = path.join(backupsDir, version);

  // `version` is renderer-supplied over IPC — a traversal sequence here
  // (e.g. `../../../../some/dir`) must never let this read/copy `.db`
  // files from outside the app's own backups directory.
  await assertPathWithinDir(backupsDir, versionPath);

  const files = (await readdir(versionPath)).filter(file => file.endsWith('.db'));
  if (!files.length) {
    throw new Error('That folder does not hold a backup of your data.');
  }
  // Keep what is there now, so a restore can be undone. If this fails nothing is replaced.
  const safetyCopy = await createBackup(new Date(), 'before-restore');
  if (keep) {
    await pruneBackups(keep, version, safetyCopy.name);
  }
  await Promise.all(files.map(file => copyFile(path.join(versionPath, file), path.join(dataPath, file))));
  console.log('[main] Restored backup from:', versionPath);
  electron.app.relaunch();
  electron.app.exit();
}

export const getDataPath = () => process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData');
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

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

const timestamp = (date: Date) => date.toISOString().replace(/[:T]/g, '-').slice(0, 19);

// A backup the person asked for. Unlike the one made on each update, there can be many.
export async function createBackup(now = new Date(), prefix: string = version): Promise<BackupInfo> {
  const dataPath = getDataPath();
  const base = `${prefix}-${timestamp(now)}`;
  // Two backups in the same second must not share a folder
  let name = base;
  for (let attempt = 2; await exists(path.join(getBackupsFolder(), name)); attempt += 1) {
    name = `${base}-${attempt}`;
  }
  const folder = path.join(getBackupsFolder(), name);
  await mkdir(folder, { recursive: true });
  const files = await dbFiles(dataPath);
  for (const file of files) {
    await copyFile(path.join(dataPath, file), path.join(folder, file));
  }
  return { name, createdAt: Date.now(), files: files.length, sizeBytes: await sizeOf(folder, files) };
}

const PREFERENCES_BACKUP_FOLDER = 'preferences';

// Deletes the oldest backups beyond the newest `keep`. The `protect`ed ones always stay, such as the one being restored
// and the copy made just before it, and count toward the limit.
export async function pruneBackups(keep: number, ...protect: string[]): Promise<string[]> {
  const limit = Math.max(1, Math.floor(keep));
  const backupsDir = getBackupsFolder();
  const removed: string[] = [];
  const all = await listBackups();
  const protectedCount = all.filter(backup => protect.includes(backup.name)).length;
  const rest = all.filter(backup => !protect.includes(backup.name));
  for (const backup of rest.slice(Math.max(0, limit - protectedCount))) {
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

// The name of the backup a person picked in the folder window, or an error if what they picked is not a backup
export async function resolveChosenBackup(chosen: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  // Windows and macOS file systems ignore case, and the dialog can spell the path differently
  const normal = (target: string) => {
    const resolved = path.resolve(target);
    return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
  };
  if (normal(path.dirname(chosen)) !== normal(getBackupsFolder())) {
    throw new Error('Pick one of the folders inside the backups folder.');
  }
  if (!(await dbFiles(chosen)).length) {
    throw new Error('That folder does not hold a backup of your data.');
  }
  return path.basename(chosen);
}
