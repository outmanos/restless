import { readdirSync } from 'node:fs';

import type { AllTypes } from 'insomnia-data';
import { models } from 'insomnia-data';
import { createNedbDatabase } from 'insomnia-data/node';
import { describe, expect, it, vi } from 'vitest';

import {
  allKnownTypes,
  dbFileName,
  GIT_TYPES,
  IMPORTED_TYPES,
  isImportedType,
  isKnownType,
  QUIET_TYPES,
  SECRET_TYPES,
  typeOfDbFile,
  typeRank,
} from './models';
import { makeTempDir } from './test-support';

describe('the model table', () => {
  it('has exactly the model types restless has: none missing, none extra, none twice', () => {
    const listed = [...IMPORTED_TYPES, ...GIT_TYPES, ...SECRET_TYPES, ...QUIET_TYPES];

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...models.types()].sort());
    expect(allKnownTypes().sort()).toEqual([...models.types()].sort());
  });

  it('names data files the way the database does', async () => {
    // Opens the real database on an empty folder, which creates one file per model type
    const dbPath = makeTempDir();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const database = createNedbDatabase();
    await database.init({ dbPath });
    await Promise.all(models.types().map(type => database.count(type as AllTypes)));

    expect(readdirSync(dbPath).sort()).toEqual(models.types().map(dbFileName).sort());
  });

  it('maps a data file name back to its type', () => {
    expect(typeOfDbFile('insomnia.OAuth2Token.db')).toBe('OAuth2Token');
    expect(typeOfDbFile('insomnia.Request.db~')).toBeNull();
    expect(typeOfDbFile('Request.db')).toBeNull();
    expect(typeOfDbFile('insomnia.Request.db.bak')).toBeNull();
    expect(isKnownType('Request')).toBe(true);
    expect(isKnownType('FutureThing')).toBe(false);
    expect(isImportedType('Settings')).toBe(false);
  });

  it('puts a parent type before the types that live under it', () => {
    const parentBeforeChild: [string, string][] = [
      ['Project', 'Workspace'],
      ['Workspace', 'Environment'],
      ['Workspace', 'RequestGroup'],
      ['RequestGroup', 'Request'],
      ['Request', 'RequestMeta'],
      ['MockServer', 'MockRoute'],
      ['ProtoDirectory', 'ProtoFile'],
      ['UnitTestSuite', 'UnitTest'],
      ['McpRequest', 'McpPayload'],
    ];

    for (const [parent, child] of parentBeforeChild) {
      expect(typeRank(parent), `${parent} before ${child}`).toBeLessThan(typeRank(child));
    }
  });
});
