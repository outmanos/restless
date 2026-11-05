import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { appDataDir, describeSource, type DetectOptions, detectSources, detectSourcesIn } from './detect';
import { setTimes, writeFixture, writeLog } from './insomnia/make-fixture';
import { dbFileName } from './insomnia/models';
import { expectUntouched, makeTempDir } from './insomnia/test-support';
import type { SourceKind } from './types';

type Env = Record<string, string | undefined>;

// A home folder with nothing in it. Every read of it goes through detect() or describeAt(), which check that nothing
// in the home was changed, so every test here also proves that.
function machine(platform: NodeJS.Platform = 'linux', makeEnv: (home: string) => Env = () => ({})) {
  const homedir = makeTempDir();
  const env = makeEnv(homedir);
  const options = (extra: Partial<DetectOptions> = {}): DetectOptions => ({
    platform,
    homedir,
    env,
    ownFolders: [],
    ...extra,
  });
  return {
    homedir,
    appData: appDataDir({ platform, homedir, env }),
    detect: (extra?: Partial<DetectOptions>) => expectUntouched(homedir, () => detectSourcesIn(options(extra))),
    describeAt: (dir: string, kind: SourceKind = 'insomnia', extra?: Partial<DetectOptions>) =>
      expectUntouched(homedir, () => describeSource(kind, dir, options(extra))),
  };
}

// The smallest folder that counts as a data folder
function seed(dir: string) {
  writeLog(dir, 'Workspace', [{ _id: 'wrk_1', type: 'Workspace', parentId: 'proj_1', name: 'One' }]);
  setTimes(dir);
}

// A pid that no process has
function deadPid() {
  for (let pid = 2_147_000_000; ; pid -= 1000) {
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
}

const onWindows = process.platform === 'win32';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('detectSourcesIn()', () => {
  it('finds Insomnia and Insomnium, in that order, with a stable id', async () => {
    const { detect, appData } = machine();
    seed(path.join(appData, 'Insomnium'));
    seed(path.join(appData, 'Insomnia'));

    const sources = await detect();

    expect(sources.map(source => [source.id, source.kind, source.path])).toEqual([
      [`insomnia:${path.join(appData, 'Insomnia')}`, 'insomnia', path.join(appData, 'Insomnia')],
      [`insomnium:${path.join(appData, 'Insomnium')}`, 'insomnium', path.join(appData, 'Insomnium')],
    ]);
  });

  it('returns nothing on a machine without either', async () => {
    const { detect } = machine();

    expect(await detect()).toEqual([]);
  });

  it('only counts a folder that holds insomnia.Workspace.db as a file', async () => {
    const { detect, appData } = machine();
    writeLog(path.join(appData, 'Insomnia'), 'Project', [{ _id: 'proj_1' }]);
    mkdirSync(path.join(appData, 'Insomnium', dbFileName('Workspace')), { recursive: true });

    expect(await detect()).toEqual([]);
  });

  it('follows XDG_CONFIG_HOME, and still looks in ~/.config', async () => {
    const { homedir, detect } = machine('linux', home => ({ XDG_CONFIG_HOME: path.join(home, 'xdg') }));
    seed(path.join(homedir, 'xdg', 'Insomnia'));
    seed(path.join(homedir, '.config', 'Insomnium'));

    const sources = await detect();

    expect(sources.map(source => source.path)).toEqual([
      path.join(homedir, 'xdg', 'Insomnia'),
      path.join(homedir, '.config', 'Insomnium'),
    ]);
  });

  it('ignores a relative XDG_CONFIG_HOME, as Electron does', async () => {
    const { homedir, detect } = machine('linux', () => ({ XDG_CONFIG_HOME: 'relative/config' }));
    seed(path.join(homedir, '.config', 'Insomnia'));

    const sources = await detect();

    expect(sources.map(source => source.path)).toEqual([path.join(homedir, '.config', 'Insomnia')]);
  });

  it('looks in Application Support on macOS', async () => {
    const { homedir, detect } = machine('darwin');
    seed(path.join(homedir, 'Library', 'Application Support', 'Insomnia'));
    seed(path.join(homedir, 'Library', 'Application Support', 'Insomnium'));
    // Linux locations mean nothing on a Mac
    seed(path.join(homedir, '.config', 'Insomnia'));

    const sources = await detect();

    expect(sources.map(source => source.path)).toEqual([
      path.join(homedir, 'Library', 'Application Support', 'Insomnia'),
      path.join(homedir, 'Library', 'Application Support', 'Insomnium'),
    ]);
  });

  it('looks in APPDATA on Windows, and in AppData/Roaming if it is not set', async () => {
    const withEnv = machine('win32', home => ({ APPDATA: path.join(home, 'Roaming') }));
    seed(path.join(withEnv.homedir, 'Roaming', 'Insomnia'));
    const without = machine('win32');
    seed(path.join(without.homedir, 'AppData', 'Roaming', 'Insomnium'));

    expect((await withEnv.detect()).map(source => source.path)).toEqual([
      path.join(withEnv.homedir, 'Roaming', 'Insomnia'),
    ]);
    expect((await without.detect()).map(source => [source.kind, source.path])).toEqual([
      ['insomnium', path.join(without.homedir, 'AppData', 'Roaming', 'Insomnium')],
    ]);
  });

  it('finds the Flatpak and snap installs of Insomnia on Linux', async () => {
    const { homedir, detect } = machine();
    const flatpak = path.join(homedir, '.var', 'app', 'rest.insomnia.Insomnia', 'config', 'Insomnia');
    const snap = path.join(homedir, 'snap', 'insomnia', 'current', '.config', 'Insomnia');
    seed(flatpak);
    seed(snap);

    const sources = await detect();

    expect(sources.map(source => [source.kind, source.path])).toEqual([
      ['insomnia', flatpak],
      ['insomnia', snap],
    ]);
  });

  it('does not look for Flatpak or snap folders on other platforms', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { homedir, detect } = machine(platform);
      seed(path.join(homedir, '.var', 'app', 'rest.insomnia.Insomnia', 'config', 'Insomnia'));
      seed(path.join(homedir, 'snap', 'insomnia', 'current', '.config', 'Insomnia'));

      expect(await detect()).toEqual([]);
    }
  });

  it("never lists restless's own folder, however it is reached", async () => {
    const { detect, appData } = machine();
    const own = path.join(appData, 'Insomnia');
    seed(own);
    // Another spelling of the same folder, and a link to it
    const link = path.join(appData, 'Insomnium');
    symlinkSync(own, link);

    expect(await detect({ ownFolders: [own] })).toEqual([]);
    expect(await detect({ ownFolders: [path.join(own, '..', 'Insomnia')] })).toEqual([]);
    expect(await detect({ ownFolders: [link] })).toEqual([]);
  });

  it('never lists the Restless folder or the insomnia-app development folder', async () => {
    const { detect, appData } = machine();
    seed(path.join(appData, 'Restless'));
    seed(path.join(appData, 'insomnia-app'));
    seed(path.join(appData, 'insomnia'));

    expect(await detect()).toEqual([]);
  });

  it('lists a folder once when two paths lead to it', async () => {
    const { detect, appData } = machine();
    seed(path.join(appData, 'Insomnia'));
    symlinkSync(path.join(appData, 'Insomnia'), path.join(appData, 'Insomnium'));

    const sources = await detect();

    expect(sources.map(source => source.kind)).toEqual(['insomnia']);
  });

  it('counts what the logs hold after updates and deletes', async () => {
    const { detect, appData } = machine();
    writeFixture(path.join(appData, 'Insomnia'));

    const [source] = await detect();

    // 11 projects were written and one was removed. 12 workspaces, one removed. 9 requests of the plain kind after
    // one removal, and one each of gRPC, WebSocket, Socket.IO and MCP. 4 environments, one written twice.
    expect(source.counts).toEqual({ projects: 10, collections: 11, requests: 13, environments: 4 });
  });

  it('reads a torn last line without complaint', async () => {
    const { detect, appData } = machine();
    writeFixture(path.join(appData, 'Insomnia'), { tornTail: true });

    const [source] = await detect();

    expect(source.counts.requests).toBe(13);
  });

  it('counts zero for files an older install does not have', async () => {
    const { detect, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeLog(dir, 'Workspace', [{ _id: 'wrk_1' }, { _id: 'wrk_2' }]);
    writeLog(dir, 'Request', [{ _id: 'req_1' }]);
    setTimes(dir);

    const [source] = await detect();

    expect(source.counts).toEqual({ projects: 0, collections: 2, requests: 1, environments: 0 });
  });

  it('leaves everything it looks at as it was, including a lock and a torn file', async () => {
    const { detect, appData } = machine();
    writeFixture(path.join(appData, 'Insomnia'), { tornTail: true });
    writeFixture(path.join(appData, 'Insomnium'));
    if (!onWindows) {
      symlinkSync(`${os.hostname()}-${process.pid}`, path.join(appData, 'Insomnia', 'SingletonLock'));
    }

    expect(await detect()).toHaveLength(2);
  });
});

describe('running', () => {
  it('is false for a folder nothing has written to lately and nothing has locked', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);

    expect((await describeAt(dir))?.running).toBe(false);
  });

  it('is true when a data file was written in the last minute', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);
    const now = new Date();
    utimesSync(path.join(dir, dbFileName('Request')), now, now);

    expect((await describeAt(dir))?.running).toBe(true);
  });

  it('is not fooled by files that are not data files', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);
    const now = new Date();
    utimesSync(path.join(dir, 'Preferences'), now, now);

    expect((await describeAt(dir))?.running).toBe(false);
  });

  it.skipIf(onWindows)('is true when the single instance lock points at a live process on this machine', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);
    symlinkSync(`${os.hostname()}-${process.pid}`, path.join(dir, 'SingletonLock'));

    expect((await describeAt(dir))?.running).toBe(true);
  });

  it.skipIf(onWindows)('is false when the lock is left over from a process that is gone', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);
    symlinkSync(`${os.hostname()}-${deadPid()}`, path.join(dir, 'SingletonLock'));

    expect((await describeAt(dir))?.running).toBe(false);
  });

  it.skipIf(onWindows)('takes a lock from another machine, or in an unknown format, as live', async () => {
    const { describeAt, appData } = machine();
    const other = path.join(appData, 'Insomnia');
    const odd = path.join(appData, 'Insomnium');
    const zero = path.join(appData, 'Other');
    writeFixture(other);
    writeFixture(odd);
    writeFixture(zero);
    symlinkSync(`some-other-host-${process.pid}`, path.join(other, 'SingletonLock'));
    symlinkSync('unexpected', path.join(odd, 'SingletonLock'));
    symlinkSync(`${os.hostname()}-0`, path.join(zero, 'SingletonLock'));

    expect((await describeAt(other))?.running).toBe(true);
    expect((await describeAt(odd, 'insomnium'))?.running).toBe(true);
    expect((await describeAt(zero))?.running).toBe(true);
  });

  it('is true on Windows while lockfile exists, and ignores the POSIX lock there', async () => {
    const { describeAt, appData } = machine('win32', home => ({ APPDATA: path.join(home, 'Roaming') }));
    const dir = path.join(appData, 'Insomnia');
    writeFixture(dir);
    expect((await describeAt(dir))?.running).toBe(false);

    writeFileSync(path.join(dir, 'lockfile'), '');
    setTimes(dir);
    expect((await describeAt(dir))?.running).toBe(true);
  });
});

describe('describeSource()', () => {
  it('returns null for a folder that is not there, or is restless itself', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    seed(dir);

    expect(await describeAt(path.join(appData, 'nothing'))).toBeNull();
    expect(await describeAt(dir, 'insomnia', { ownFolders: [dir] })).toBeNull();
    expect((await describeAt(dir))?.path).toBe(dir);
  });

  it('normalises the path it is given', async () => {
    const { describeAt, appData } = machine();
    const dir = path.join(appData, 'Insomnia');
    seed(dir);

    const source = await describeAt(path.join(dir, '..', 'Insomnia', '.'), 'insomnium');

    expect(source?.id).toBe(`insomnium:${dir}`);
  });
});

describe('detectSources()', () => {
  // The real defaults, pointed at an empty home so the machine running the tests is never read
  function emptyHome() {
    const home = makeTempDir();
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('APPDATA', path.join(home, 'AppData', 'Roaming'));
    vi.stubEnv('XDG_CONFIG_HOME', '');
    vi.stubEnv('INSOMNIA_DATA_PATH', path.join(home, 'restless-data'));
    return home;
  }

  it('looks under the real home and app data folders of the current platform', async () => {
    const home = emptyHome();
    expect(await expectUntouched(home, detectSources)).toEqual([]);

    const appData = appDataDir({ platform: process.platform, homedir: home, env: process.env });
    seed(path.join(appData, 'Insomnium'));

    const sources = await expectUntouched(home, detectSources);

    expect(sources.map(source => [source.kind, source.path])).toEqual([['insomnium', path.join(appData, 'Insomnium')]]);
  });

  it('leaves out the folder INSOMNIA_DATA_PATH names, which is the one restless is using', async () => {
    const home = emptyHome();
    const appData = appDataDir({ platform: process.platform, homedir: home, env: process.env });
    seed(path.join(appData, 'Insomnia'));
    vi.stubEnv('INSOMNIA_DATA_PATH', path.join(appData, 'Insomnia'));

    expect(await expectUntouched(home, detectSources)).toEqual([]);
  });
});
