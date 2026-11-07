// Finds Insomnia and Insomnium data folders on this machine. It only reads: no file, folder or lock in a source is
// ever written, and nothing here touches the network.
import { access, readdir, readlink, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { userDataFolder } from '../../../config/config.json';
import { dbFileName, REQUEST_TYPES, typeOfDbFile } from './insomnia/models';
import { countLog } from './insomnia/read-log';
import type { DetectedSource, SourceKind } from './types';

export interface DetectOptions {
  platform: NodeJS.Platform;
  homedir: string;
  env: Record<string, string | undefined>;
  // Folders restless itself uses. They are never offered as a source.
  ownFolders: string[];
}

// A write this recent counts as the app being open
const RECENT_WRITE_MS = 60_000;

// Where Electron keeps per user app data on each platform
export function appDataDir({ platform, homedir, env }: Pick<DetectOptions, 'platform' | 'homedir' | 'env'>) {
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support');
  }
  if (platform === 'win32') {
    return env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
  }
  // The XDG spec says to ignore a relative path, and so does Electron
  const xdg = env.XDG_CONFIG_HOME;
  return xdg && path.isAbsolute(xdg) ? xdg : path.join(homedir, '.config');
}

export function defaultDetectOptions(): DetectOptions {
  const { platform, env } = process;
  const homedir = os.homedir();
  const appData = appDataDir({ platform, homedir, env });
  return {
    platform,
    homedir,
    env,
    // INSOMNIA_DATA_PATH is what restless uses when it is set. `insomnia-app` is where a development build keeps
    // its data, and it is also what an Insomnia development build uses.
    ownFolders: [env.INSOMNIA_DATA_PATH, path.join(appData, userDataFolder), path.join(appData, 'insomnia-app')].filter(
      (folder): folder is string => !!folder,
    ),
  };
}

interface Candidate {
  kind: SourceKind;
  path: string;
}

// Where an install can keep its data. A folder only counts if it holds insomnia.Workspace.db, so a path that does
// not exist on a given machine costs nothing.
function candidateFolders(options: DetectOptions): Candidate[] {
  const { platform, homedir } = options;
  const appData = appDataDir(options);
  const candidates: Candidate[] = [
    { kind: 'insomnia', path: path.join(appData, 'Insomnia') },
    { kind: 'insomnium', path: path.join(appData, 'Insomnium') },
  ];

  if (platform === 'linux') {
    const dotConfig = path.join(homedir, '.config');
    candidates.push(
      // XDG_CONFIG_HOME may have been set after the data was created
      ...(dotConfig === appData
        ? []
        : [
            { kind: 'insomnia' as const, path: path.join(dotConfig, 'Insomnia') },
            { kind: 'insomnium' as const, path: path.join(dotConfig, 'Insomnium') },
          ]),
      // Flatpak. Flathub lists Insomnia as rest.insomnia.Insomnia, and its manifest does not override
      // XDG_CONFIG_HOME, so the sandbox's config home is ~/.var/app/<app id>/config as for any Flatpak app.
      { kind: 'insomnia', path: path.join(homedir, '.var', 'app', 'rest.insomnia.Insomnia', 'config', 'Insomnia') },
      // Snap. The `insomnia` snap installs without --classic, so the app sees ~/snap/insomnia/<revision> as its home,
      // and `current` points at the revision in use. Users of the snap report their plugin folder at this path in
      // Kong/insomnia#905. That is from 2019 to 2021 and has not been checked against a current revision.
      { kind: 'insomnia', path: path.join(homedir, 'snap', 'insomnia', 'current', '.config', 'Insomnia') },
      // Insomnium has no Flatpak or snap: neither has been published.
    );
  }

  return candidates;
}

async function isFile(file: string) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveReal(folder: string) {
  try {
    return await realpath(folder);
  } catch {
    return path.resolve(folder);
  }
}

// Windows and macOS file systems ignore case by default
const comparable = (platform: NodeJS.Platform, folder: string) =>
  platform === 'win32' || platform === 'darwin' ? folder.toLowerCase() : folder;

async function isOwnFolder(folder: string, { platform, ownFolders }: DetectOptions) {
  const own = new Set<string>();
  for (const ownFolder of ownFolders) {
    own.add(comparable(platform, path.resolve(ownFolder)));
    own.add(comparable(platform, await resolveReal(ownFolder)));
  }
  return (
    own.has(comparable(platform, path.resolve(folder))) || own.has(comparable(platform, await resolveReal(folder)))
  );
}

async function liveCount(folder: string, type: string) {
  try {
    return (await countLog(path.join(folder, dbFileName(type)))).count;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[migration] Could not count ${type} in ${folder}:`, error?.code ?? error);
    }
    return 0;
  }
}

// What the install holds, from replaying its logs: later lines replace earlier ones and deleted documents are gone.
// `collections` counts every workspace, whatever its scope, and `environments` counts base and sub environments.
async function countContents(folder: string): Promise<DetectedSource['counts']> {
  const [projects, collections, environments, ...requests] = await Promise.all([
    liveCount(folder, 'Project'),
    liveCount(folder, 'Workspace'),
    liveCount(folder, 'Environment'),
    ...REQUEST_TYPES.map(type => liveCount(folder, type)),
  ]);
  return { projects, collections, environments, requests: requests.reduce((sum, count) => sum + count, 0) };
}

function isAlive(pid: number) {
  try {
    // Signal 0 only checks that the process exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

// Electron's single instance lock, which Insomnia takes. Chromium makes it a symlink named `SingletonLock` that
// points at `<hostname>-<pid>`, or on Windows a `lockfile` that stays open while the app runs.
async function holdsLock(folder: string, platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return exists(path.join(folder, 'lockfile'));
  }
  let target: string;
  try {
    target = await readlink(path.join(folder, 'SingletonLock'));
  } catch {
    return false;
  }
  const match = /^(.+)-(\d+)$/.exec(target);
  const pid = match ? Number(match[2]) : 0;
  // A lock from another machine sharing this folder, or in a format we do not know, is taken as live. A sandboxed
  // app has its own process ids, so for Flatpak and snap this is a guess either way.
  if (!match || match[1] !== os.hostname() || pid <= 0) {
    return true;
  }
  return isAlive(pid);
}

async function wroteRecently(folder: string) {
  try {
    const names = (await readdir(folder)).filter(name => typeOfDbFile(name) !== null);
    const times = await Promise.all(
      names.map(async name => {
        try {
          return (await stat(path.join(folder, name))).mtimeMs;
        } catch {
          return 0;
        }
      }),
    );
    return times.some(time => Date.now() - time < RECENT_WRITE_MS);
  } catch {
    return false;
  }
}

// Best effort: a stale lock after a crash looks the same as an open app, and an idle app that holds no lock on
// some platform looks closed
async function looksRunning(folder: string, platform: NodeJS.Platform) {
  return (await holdsLock(folder, platform)) || (await wroteRecently(folder));
}

// Describes one folder, or returns null if it is not an Insomnia data folder or is restless's own. Used to detect
// installs, and to check a source that comes back over IPC before it is read.
export async function describeSource(
  kind: SourceKind,
  dir: string,
  options: DetectOptions = defaultDetectOptions(),
): Promise<DetectedSource | null> {
  const folder = path.resolve(dir);
  if (!(await isFile(path.join(folder, dbFileName('Workspace')))) || (await isOwnFolder(folder, options))) {
    return null;
  }
  const [counts, running] = await Promise.all([countContents(folder), looksRunning(folder, options.platform)]);
  return { id: `${kind}:${folder}`, kind, path: folder, counts, running };
}

export async function detectSourcesIn(options: DetectOptions): Promise<DetectedSource[]> {
  const described = await Promise.all(
    candidateFolders(options).map(candidate => describeSource(candidate.kind, candidate.path, options)),
  );

  // The same folder can be reached twice, through a symlink or a second spelling of the path
  const seen = new Set<string>();
  const sources: DetectedSource[] = [];
  for (const source of described) {
    if (!source) {
      continue;
    }
    const real = comparable(options.platform, await resolveReal(source.path));
    if (!seen.has(real)) {
      seen.add(real);
      sources.push(source);
    }
  }
  return sources;
}

// Where Postman keeps its data. It is only looked for, never read: restless cannot copy from Postman, so finding
// it just lets the migration window point the user to Import.
function postmanFolders({ platform, homedir, env }: DetectOptions) {
  const folders = [path.join(appDataDir({ platform, homedir, env }), 'Postman')];
  if (platform === 'linux') {
    folders.push(
      path.join(homedir, '.config', 'Postman'),
      path.join(homedir, '.var', 'app', 'com.getpostman.Postman', 'config', 'Postman'),
      path.join(homedir, 'snap', 'postman', 'current', '.config', 'Postman'),
    );
  }
  return folders;
}

export async function detectPostmanIn(options: DetectOptions): Promise<{ path: string } | null> {
  for (const folder of postmanFolders(options)) {
    try {
      if ((await stat(folder)).isDirectory()) {
        return { path: folder };
      }
    } catch {
      // Not installed here
    }
  }
  return null;
}

export async function detectPostman(): Promise<{ path: string } | null> {
  return detectPostmanIn(defaultDetectOptions());
}

export async function detectSources(): Promise<DetectedSource[]> {
  return detectSourcesIn(defaultDetectOptions());
}
