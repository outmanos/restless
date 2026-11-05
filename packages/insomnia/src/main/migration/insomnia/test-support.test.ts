import { appendFileSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { setTimes, writeFile, writeFixture } from './make-fixture';
import { expectUntouched, hashFolder, makeTempDir } from './test-support';

// The tests that read a source rely on this check to prove nothing was written, so it has to notice every kind of
// change
describe('expectUntouched()', () => {
  function folder() {
    const dir = makeTempDir();
    writeFixture(dir);
    return dir;
  }

  const fails = (dir: string, change: () => void) =>
    expect(expectUntouched(dir, async () => change())).rejects.toThrow('was changed while it was read');

  it('passes when nothing changes', async () => {
    const dir = folder();

    await expect(expectUntouched(dir, async () => 'done')).resolves.toBe('done');
  });

  it('notices a data file that is appended to', async () => {
    const dir = folder();
    await fails(dir, () => appendFileSync(path.join(dir, 'insomnia.Request.db'), '\n'));
  });

  it('notices a file that is rewritten with the same content', async () => {
    const dir = folder();
    await fails(dir, () => writeFileSync(path.join(dir, 'Preferences'), '{}'));
  });

  it('notices a file that is only touched', async () => {
    const dir = folder();
    const now = new Date();
    await fails(dir, () => utimesSync(path.join(dir, 'insomnia.Request.db'), now, now));
  });

  it('notices a file or folder that is added or removed', async () => {
    const dir = folder();
    await fails(dir, () => writeFile(dir, 'new-file', 'x'));
    setTimes(dir);
    await fails(dir, () => mkdirSync(path.join(dir, 'new-folder')));
    setTimes(dir);
    await fails(dir, () => rmSync(path.join(dir, 'Preferences')));
  });

  it('notices a lock that is created, or points somewhere else', async () => {
    const dir = folder();
    await fails(dir, () => symlinkSync('host-1', path.join(dir, 'SingletonLock')));
    rmSync(path.join(dir, 'SingletonLock'));
    setTimes(dir);
    symlinkSync('host-1', path.join(dir, 'SingletonLock'));
    const before = hashFolder(dir);
    rmSync(path.join(dir, 'SingletonLock'));
    symlinkSync('host-2', path.join(dir, 'SingletonLock'));
    expect(hashFolder(dir)).not.toBe(before);
  });
});
