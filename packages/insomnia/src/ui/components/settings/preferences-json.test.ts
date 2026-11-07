import { describe, expect, it } from 'vitest';

import { buildPreferencesFile, parsePreferencesFile, PREFERENCES_FORMAT } from './preferences-json';

const defaults = {
  fontSize: 13,
  fontInterface: null,
  followRedirects: true,
  dataFolders: [] as string[],
  httpProxy: '',
  deviceId: null,
  hasSeenMigrationOffer: false,
  disabledSecurityRules: [] as string[],
  hotKeyRegistry: { request_send: { macKeys: [], winLinuxKeys: [] } },
};

describe('buildPreferencesFile', () => {
  it('leaves out private and per-computer settings, and sorts the rest', () => {
    const file = buildPreferencesFile(
      {
        fontSize: 15,
        followRedirects: false,
        httpProxy: 'http://user:secret@proxy',
        deviceId: 'abc',
        dataFolders: ['/home/me'],
        hasSeenMigrationOffer: true,
        _id: 'set_1',
        notASetting: 1,
      },
      defaults,
      '0.2.5',
      new Date('2026-11-07T00:00:00Z'),
    );
    expect(file).toEqual({
      format: PREFERENCES_FORMAT,
      version: 1,
      exportedAt: '2026-11-07T00:00:00.000Z',
      app: '0.2.5',
      settings: { followRedirects: false, fontSize: 15 },
    });
    expect(JSON.stringify(file)).not.toContain('secret');
  });
});

describe('parsePreferencesFile', () => {
  const wrap = (settings: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ format: PREFERENCES_FORMAT, version: 1, settings, ...extra });

  it('reads what it can apply', () => {
    const result = parsePreferencesFile(
      wrap({ fontSize: 16, followRedirects: false, fontInterface: 'Inter' }),
      defaults,
    );
    expect(result).toEqual({ settings: { fontSize: 16, followRedirects: false, fontInterface: 'Inter' }, skipped: [] });
  });

  it('skips unknown, left out and wrongly typed settings, and says why', () => {
    const result = parsePreferencesFile(
      wrap({ fontSize: 'big', httpProxy: 'http://x', mystery: 1, followRedirects: true }),
      defaults,
    );
    expect(result).toEqual({
      settings: { followRedirects: true },
      skipped: [
        { key: 'fontSize', reason: 'the wrong kind of value' },
        { key: 'httpProxy', reason: 'not a preference restless knows' },
        { key: 'mystery', reason: 'not a preference restless knows' },
      ],
    });
  });

  it('keeps only valid shortcuts', () => {
    const result = parsePreferencesFile(
      wrap({
        hotKeyRegistry: {
          request_send: { macKeys: [{ keyCode: 13 }], winLinuxKeys: [{ ctrl: true, keyCode: 13 }] },
          request_bogus: { macKeys: [], winLinuxKeys: [] },
        },
      }),
      defaults,
    );
    expect(result).toMatchObject({
      settings: { hotKeyRegistry: { request_send: { macKeys: [{ keyCode: 13 }] } } },
      skipped: [{ key: 'hotKeyRegistry.request_bogus' }],
    });
  });

  it('rejects files that are not preferences', () => {
    expect(parsePreferencesFile('nope', defaults)).toEqual({ error: 'That file is not valid JSON.' });
    expect(parsePreferencesFile('{"fontSize":13}', defaults)).toHaveProperty('error');
    expect(parsePreferencesFile(wrap({}, { version: 9 }), defaults)).toHaveProperty('error');
  });
});
