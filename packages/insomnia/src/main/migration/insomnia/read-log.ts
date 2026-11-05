// Replays Insomnia's NeDB data files without NeDB. NeDB compacts a file when it loads it, which rewrites the
// source, so these functions only ever open files for reading.
//
// A file is an append-only log with one JSON document per line. A later line with the same `_id` replaces the
// earlier one, a `{ $$deleted: true, _id }` line removes it, and `$$indexCreated` lines are ignored.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { dbFileName, typeOfDbFile } from './models';

const BYTE_ORDER_MARK = String.fromCodePoint(0xfe_ff);

export interface LogDocument {
  _id: string;
  [key: string]: any;
}

export interface UnreadableLine {
  // 1 based
  line: number;
  // The last line of a file that does not end in a newline. The app is usually open and mid write.
  torn: boolean;
}

export interface Replay {
  // Live documents in the order they were first written
  documents: LogDocument[];
  unreadable: UnreadableLine[];
}

export interface ScanOptions {
  // Bytes per read. Only tests change this.
  chunkSize?: number;
}

// Same as the reviver in @seald-io/nedb `model.deserialize`: `{ $$date: ms }` becomes a Date. Left alone, the
// marker would be rejected as a field name when the document is inserted.
function revive(key: string, value: any) {
  if (key === '$$date') {
    return new Date(value);
  }
  if (value && typeof value === 'object' && value.$$date) {
    return value.$$date;
  }
  return value;
}

async function scan(
  file: string,
  visit: (id: string, document: LogDocument | null) => void,
  { chunkSize = 1 << 20 }: ScanOptions = {},
): Promise<UnreadableLine[]> {
  // A named pipe or device would never end
  if (!(await stat(file)).isFile()) {
    throw Object.assign(new Error(`${file} is not a regular file`), { code: 'ENOTFILE' });
  }

  const unreadable: UnreadableLine[] = [];
  let lineNumber = 0;

  const handle = (text: string, last: boolean) => {
    lineNumber += 1;
    const line = (lineNumber === 1 && text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text).trimEnd();
    if (line === '') {
      return;
    }
    let document: any;
    try {
      document = JSON.parse(line, revive);
    } catch {
      unreadable.push({ line: lineNumber, torn: last });
      return;
    }
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      unreadable.push({ line: lineNumber, torn: last });
      return;
    }
    // Index lines and anything else without an id are not documents
    if (typeof document._id !== 'string' || document._id === '') {
      return;
    }
    visit(document._id, document.$$deleted === true ? null : document);
  };

  // Lines are split on \n only. NeDB also splits on U+2028, U+2029 and U+0085, which JSON does not escape, so it
  // loses documents that contain them. This reads them.
  const decoder = new StringDecoder('utf8');
  let pieces: string[] = [];
  const stream = createReadStream(file, { flags: 'r', highWaterMark: chunkSize });
  for await (const chunk of stream) {
    const text = decoder.write(chunk as Buffer);
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      pieces.push(text.slice(start, end));
      handle(pieces.length === 1 ? pieces[0] : pieces.join(''), false);
      pieces = [];
      start = end + 1;
    }
    if (start < text.length) {
      pieces.push(text.slice(start));
    }
  }
  const rest = pieces.join('') + decoder.end();
  if (rest !== '') {
    handle(rest, true);
  }
  return unreadable;
}

export async function replayLog(file: string, options?: ScanOptions): Promise<Replay> {
  // A Map keeps the position of a replaced key, as NeDB's own table does
  const live = new Map<string, LogDocument>();
  const unreadable = await scan(
    file,
    (id, document) => {
      if (document) {
        live.set(id, document);
      } else {
        live.delete(id);
      }
    },
    options,
  );
  return { documents: [...live.values()], unreadable };
}

// Same replay, but keeps only the ids, so a large file is not held in memory just to be counted
export async function countLog(file: string, options?: ScanOptions) {
  const live = new Set<string>();
  const unreadable = await scan(
    file,
    (id, document) => {
      if (document) {
        live.add(id);
      } else {
        live.delete(id);
      }
    },
    options,
  );
  return { count: live.size, unreadable };
}

export interface FileProblem {
  type: string;
  file: string;
  // Empty when the file could not be opened
  lines: UnreadableLine[];
  // The fs error code when the file could not be opened
  error?: string;
}

export interface FolderRead {
  documents: Map<string, LogDocument[]>;
  problems: FileProblem[];
}

const isMissing = (error: any) => error?.code === 'ENOENT';

// The model types that have a data file in the folder, whether or not restless knows them
export async function listLogTypes(dir: string): Promise<string[]> {
  const types = (await readdir(dir)).map(typeOfDbFile).filter((type): type is string => type !== null);
  return types.sort();
}

// A missing file is an empty type, since older installs do not have the newer files
export async function readFolder(dir: string, types: readonly string[], options?: ScanOptions): Promise<FolderRead> {
  const documents = new Map<string, LogDocument[]>();
  const problems: FileProblem[] = [];

  await Promise.all(
    types.map(async type => {
      const file = dbFileName(type);
      try {
        const replay = await replayLog(path.join(dir, file), options);
        documents.set(type, replay.documents);
        if (replay.unreadable.length) {
          problems.push({ type, file, lines: replay.unreadable });
        }
      } catch (error) {
        if (!isMissing(error)) {
          problems.push({ type, file, lines: [], error: error?.code ?? 'UNKNOWN' });
        }
      }
    }),
  );

  // Promise.all finishes in any order, so keep the report stable
  problems.sort((a, b) => a.file.localeCompare(b.file));
  return { documents, problems };
}
