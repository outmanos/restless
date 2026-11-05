// Helpers shared by the migration tests. Not used by the app.
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A folder that is removed after the test
export function makeTempDir(prefix = 'restless-migration-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// Covers names, sizes, modification times, contents and link targets, without following links, so it also notices
// a file that was only touched, or a lock that was created or removed
export function hashFolder(dir: string) {
  const hash = createHash('sha256');
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const info = lstatSync(full);
      const relative = path.relative(dir, full);
      if (info.isSymbolicLink()) {
        hash.update(`link ${relative} -> ${readlinkSync(full)}\n`);
      } else if (info.isDirectory()) {
        hash.update(`dir ${relative} ${info.mtimeMs}\n`);
        walk(full);
      } else {
        hash.update(`file ${relative} ${info.size} ${info.mtimeMs}\n`);
        hash.update(readFileSync(full));
      }
    }
  };
  hash.update(`dir . ${lstatSync(dir).mtimeMs}\n`);
  walk(dir);
  return hash.digest('hex');
}

// Every test that reads a source goes through this: the folder must be byte for byte the same afterwards
export async function expectUntouched<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const before = hashFolder(dir);
  const result = await run();
  expect(hashFolder(dir), `${dir} was changed while it was read`).toBe(before);
  return result;
}
