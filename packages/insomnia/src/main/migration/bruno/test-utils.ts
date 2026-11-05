import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const FIXTURES = path.join(__dirname, '__fixtures__');
export const BRU_COLLECTION = path.join(FIXTURES, 'bru-collection');
export const YML_COLLECTION = path.join(FIXTURES, 'yml-collection');
export const YML_OAUTH_COLLECTION = path.join(FIXTURES, 'yml-oauth-collection');

function listFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    })
    .sort();
}

// A hash of every file name and every byte below a folder, to prove that a read changed nothing
export function hashDirectory(directory: string): string {
  const hash = createHash('sha256');
  for (const file of listFiles(directory)) {
    hash.update(`${path.relative(directory, file)}\0`).update(fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

// NeDB refuses a key with a dot, or one that starts with $, at any depth
export function nedbKeyProblems(value: unknown, location = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key.includes('.') || key.startsWith('$') ? [`${location}/${key}`] : []),
    ...nedbKeyProblems(child, `${location}/${key}`),
  ]);
}
