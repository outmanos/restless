import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deleted, writeFixture, writeLog } from './make-fixture';
import { allKnownTypes, dbFileName } from './models';
import { countLog, listLogTypes, readFolder, replayLog } from './read-log';
import { expectUntouched, makeTempDir } from './test-support';

// Replays one type's file, and checks the folder was left exactly as it was
async function replay(dir: string, type = 'Request', options?: { chunkSize?: number }) {
  return expectUntouched(dir, () => replayLog(path.join(dir, dbFileName(type)), options));
}

const writeRaw = (dir: string, text: string, type = 'Request') => writeFileSync(path.join(dir, dbFileName(type)), text);

describe('replayLog()', () => {
  it('keeps the latest version of each document, replaced whole and in the order first written', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Request', [
      { _id: 'a', name: 'a1', onlyInFirst: true },
      { _id: 'b', name: 'b1' },
      { _id: 'a', name: 'a2' },
    ]);

    const { documents, unreadable } = await replay(dir);

    expect(documents).toEqual([
      { _id: 'a', name: 'a2' },
      { _id: 'b', name: 'b1' },
    ]);
    expect(unreadable).toEqual([]);
  });

  it('removes deleted documents, and puts one that comes back at the end', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Request', [{ _id: 'a' }, { _id: 'b' }, deleted('a'), { _id: 'c' }, { _id: 'a', again: true }]);

    const { documents } = await replay(dir);

    expect(documents.map(document => document._id)).toEqual(['b', 'c', 'a']);
    expect(documents[2]).toEqual({ _id: 'a', again: true });
  });

  it('ignores index lines, blank lines and lines without an id', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Request', [
      { $$indexCreated: { fieldName: 'name', unique: true, sparse: false } },
      { $$indexRemoved: 'name' },
      '',
      '   ',
      { name: 'no id' },
      { _id: 5 },
      { _id: '' },
      { _id: 'kept' },
    ]);

    const { documents, unreadable } = await replay(dir);

    expect(documents).toEqual([{ _id: 'kept' }]);
    expect(unreadable).toEqual([]);
  });

  it('turns date markers back into dates, wherever they are nested', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '{"_id":"a","created":{"$$date":5},"list":[{"when":{"$$date":10}}],"plain":{"x":1}}\n');

    const [document] = (await replay(dir)).documents;

    expect(document.created).toBeInstanceOf(Date);
    expect(document.created.getTime()).toBe(5);
    expect(document.list[0].when.getTime()).toBe(10);
    expect(document.plain).toEqual({ x: 1 });
  });

  it('drops a torn final line and reports it as torn', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '{"_id":"a","name":"complete"}\n{"_id":"b","name":"cut sho');

    const { documents, unreadable } = await replay(dir);

    expect(documents).toEqual([{ _id: 'a', name: 'complete' }]);
    expect(unreadable).toEqual([{ line: 2, torn: true }]);
  });

  it('keeps a last line that is complete even though it has no newline', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '{"_id":"a"}\n{"_id":"b"}');

    const { documents, unreadable } = await replay(dir);

    expect(documents.map(document => document._id)).toEqual(['a', 'b']);
    expect(unreadable).toEqual([]);
  });

  it('skips a damaged line in the middle and does not call it torn', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '{"_id":"a"}\nnot json at all\n{"_id":"b"}\n');

    const { documents, unreadable } = await replay(dir);

    expect(documents.map(document => document._id)).toEqual(['a', 'b']);
    expect(unreadable).toEqual([{ line: 2, torn: false }]);
  });

  it('counts a line that is valid JSON but not a document as unreadable', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '[1,2]\nnull\n5\n"text"\n{"_id":"a"}\n');

    const { documents, unreadable } = await replay(dir);

    expect(documents).toHaveLength(1);
    expect(unreadable.map(entry => entry.line)).toEqual([1, 2, 3, 4]);
  });

  it('reads CRLF line endings and a byte order mark', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '\u{FEFF}{"_id":"a"}\r\n{"_id":"b"}\r\n');

    const { documents, unreadable } = await replay(dir);

    expect(documents.map(document => document._id)).toEqual(['a', 'b']);
    expect(unreadable).toEqual([]);
  });

  it('reads multi byte characters that are split across reads', async () => {
    const dir = makeTempDir();
    // U+2028 is not escaped by JSON, and NeDB would cut the line there
    const text = 'caf\u{E9} \u{1F600} line\u{2028}break \u{4E2D}\u{6587}';
    writeLog(dir, 'Request', [
      { _id: 'a', text },
      { _id: 'b', text },
    ]);

    const { documents, unreadable } = await replay(dir, 'Request', { chunkSize: 3 });

    expect(documents.map(document => document.text)).toEqual([text, text]);
    expect(unreadable).toEqual([]);
  });

  it('reads a line that is longer than a single read', async () => {
    const dir = makeTempDir();
    const body = 'x'.repeat(5000);
    writeLog(dir, 'Request', [{ _id: 'a', body }, { _id: 'b' }]);

    const { documents } = await replay(dir, 'Request', { chunkSize: 64 });

    expect(documents[0].body).toBe(body);
    expect(documents).toHaveLength(2);
  });

  it('rejects a path that is not a regular file', async () => {
    const dir = makeTempDir();
    mkdirSync(path.join(dir, dbFileName('Request')));

    await expect(replay(dir)).rejects.toMatchObject({ code: 'ENOTFILE' });
  });

  it('rejects a file that does not exist', async () => {
    const dir = makeTempDir();

    await expect(replay(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('countLog()', () => {
  it('counts what replayLog() would return', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Request', [
      { $$indexCreated: { fieldName: 'name' } },
      { _id: 'a' },
      { _id: 'b' },
      { _id: 'a', again: true },
      deleted('b'),
      { _id: 'c' },
      'garbage',
    ]);

    const counted = await expectUntouched(dir, () => countLog(path.join(dir, dbFileName('Request'))));
    const replayed = await replay(dir);

    expect(counted.count).toBe(2);
    expect(counted.count).toBe(replayed.documents.length);
    expect(counted.unreadable).toEqual(replayed.unreadable);
  });
});

describe('listLogTypes()', () => {
  it('lists every type with a data file, including ones restless does not know, and ignores the rest', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Workspace', []);
    writeLog(dir, 'OAuth2Token', []);
    writeLog(dir, 'FutureThing', []);
    writeFileSync(path.join(dir, 'insomnia.Request.db~'), '');
    writeFileSync(path.join(dir, 'Preferences'), '');
    writeFileSync(path.join(dir, 'other.Request.db'), '');

    expect(await expectUntouched(dir, () => listLogTypes(dir))).toEqual(['FutureThing', 'OAuth2Token', 'Workspace']);
  });
});

describe('readFolder()', () => {
  it('treats a missing file as no documents, since older installs lack the newer files', async () => {
    const dir = makeTempDir();
    writeLog(dir, 'Workspace', [{ _id: 'w' }]);

    const { documents, problems } = await expectUntouched(dir, () => readFolder(dir, ['Workspace', 'McpRequest']));

    expect(documents.get('Workspace')).toEqual([{ _id: 'w' }]);
    expect(documents.has('McpRequest')).toBe(false);
    expect(problems).toEqual([]);
  });

  it('reports files with unreadable lines, and files that cannot be read', async () => {
    const dir = makeTempDir();
    writeRaw(dir, '{"_id":"a"}\n{"_id":"b","na', 'Request');
    mkdirSync(path.join(dir, dbFileName('Workspace')));
    writeLog(dir, 'Project', [{ _id: 'p' }]);

    const { documents, problems } = await expectUntouched(dir, () =>
      readFolder(dir, ['Workspace', 'Request', 'Project']),
    );

    expect(documents.get('Request')).toEqual([{ _id: 'a' }]);
    expect(documents.get('Project')).toEqual([{ _id: 'p' }]);
    expect(problems).toEqual([
      { type: 'Request', file: 'insomnia.Request.db', lines: [{ line: 2, torn: true }] },
      { type: 'Workspace', file: 'insomnia.Workspace.db', lines: [], error: 'ENOTFILE' },
    ]);
  });

  it('reads a whole generated folder, including a torn tail, without changing it', async () => {
    const dir = makeTempDir();
    writeFixture(dir, { tornTail: true });

    const { documents, problems } = await expectUntouched(dir, () => readFolder(dir, allKnownTypes()));

    // Updated twice and removed once: only the latest version of each document is left
    const requests = documents.get('Request')!;
    expect(requests.find(request => request._id === 'req_get_users')?.name).toBe('Get users');
    expect(requests.some(request => request._id === 'req_gone')).toBe(false);
    expect(documents.get('Project')!.find(project => project._id === 'proj_local')?.name).toBe('My Project');
    expect(documents.get('Project')!.some(project => project._id === 'proj_removed')).toBe(false);
    expect(documents.get('Environment')!.find(env => env._id === 'env_main_dev')?.name).toBe('Dev renamed');
    // The cookie jar's dates came back as dates
    expect(documents.get('CookieJar')![0].cookies[0].expires).toBeInstanceOf(Date);
    expect(problems).toEqual([
      { type: 'Request', file: 'insomnia.Request.db', lines: [{ line: expect.any(Number), torn: true }] },
    ]);
  });
});
