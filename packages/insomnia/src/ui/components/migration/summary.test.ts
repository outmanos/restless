import { describe, expect, it } from 'vitest';

import type { ReportEntry } from '~/main/migration/types';

import { REASON_INFO } from './labels';
import {
  collectPlugins,
  commonFolder,
  countItemsByType,
  describeCounts,
  describeItems,
  formatCount,
  formatNumber,
  groupEntries,
  hasContent,
  keyEntries,
  planTitle,
  sumCounts,
  summarizeCounts,
  withOrigin,
} from './summary';
import { makeEntry, makeItem, makePlan, makeSource, NOTHING } from './test-fixtures';

describe('formatCount() and formatNumber()', () => {
  it('uses the singular for exactly one', () => {
    expect(formatCount(1, 'request')).toBe('1 request');
    expect(formatCount(0, 'request')).toBe('0 requests');
    expect(formatCount(2, 'request')).toBe('2 requests');
  });

  it('takes an explicit plural', () => {
    expect(formatCount(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('groups thousands the same way on every machine', () => {
    expect(formatNumber(1_234_567)).toBe('1,234,567');
    expect(formatCount(12_000, 'request')).toBe('12,000 requests');
  });
});

describe('describeCounts()', () => {
  it('lists the non-zero counts in a fixed order', () => {
    expect(describeCounts({ projects: 2, collections: 5, requests: 120, environments: 4 })).toBe(
      '2 projects, 5 collections, 120 requests, 4 environments',
    );
  });

  it('uses the singular and skips zeros', () => {
    expect(describeCounts({ projects: 0, collections: 1, requests: 1, environments: 0 })).toBe(
      '1 collection, 1 request',
    );
  });

  it('says so when there is nothing', () => {
    expect(describeCounts({ projects: 0, collections: 0, requests: 0, environments: 0 })).toBe('Nothing to copy');
    expect(describeCounts(NOTHING)).toBe('Nothing to copy');
  });

  it('ignores values that are not counts', () => {
    expect(describeCounts({ projects: Number.NaN, collections: -3, requests: 2.9, environments: undefined })).toBe(
      '2 requests',
    );
  });
});

describe('hasContent()', () => {
  it('needs a collection or a request', () => {
    expect(hasContent(makeSource({ counts: { projects: 1, collections: 1, requests: 0, environments: 0 } }))).toBe(
      true,
    );
    expect(hasContent(makeSource({ counts: { projects: 0, collections: 0, requests: 3, environments: 0 } }))).toBe(
      true,
    );
  });

  it('does not count an empty install', () => {
    expect(hasContent(makeSource({ counts: { projects: 1, collections: 0, requests: 0, environments: 2 } }))).toBe(
      false,
    );
  });
});

describe('summarizeCounts()', () => {
  it('orders rows by kind, not by the order they arrive in', () => {
    const { rows } = summarizeCounts({ Environment: 2, Request: 5, Project: 1, RequestGroup: 3, Workspace: 1 });
    expect(rows.map(row => row.type)).toEqual(['Project', 'Workspace', 'RequestGroup', 'Request', 'Environment']);
  });

  it('matches the label to the count', () => {
    const { rows } = summarizeCounts({ Request: 1, RequestGroup: 2 });
    expect(rows).toEqual([
      { type: 'RequestGroup', count: 2, label: 'folders' },
      { type: 'Request', count: 1, label: 'request' },
    ]);
  });

  it('folds the meta models into one count', () => {
    const summary = summarizeCounts({ Request: 4, RequestMeta: 4, WorkspaceMeta: 1, RequestGroupMeta: 2 });
    expect(summary.rows.map(row => row.type)).toEqual(['Request']);
    expect(summary.supporting).toBe(7);
    expect(summary.total).toBe(11);
  });

  it('puts unknown types after the known ones, in name order', () => {
    const { rows } = summarizeCounts({ Zeta: 1, Request: 1, Alpha: 2 });
    expect(rows.map(row => row.type)).toEqual(['Request', 'Alpha', 'Zeta']);
    expect(rows[1].label).toBe('alphas');
  });

  it('drops zero, negative and broken counts', () => {
    const summary = summarizeCounts({ Request: 0, Environment: -1, Project: Number.NaN, Workspace: 2 });
    expect(summary.rows).toEqual([{ type: 'Workspace', count: 2, label: 'collections' }]);
    expect(summary.total).toBe(2);
  });

  it('handles nothing at all', () => {
    expect(summarizeCounts(NOTHING)).toEqual({ rows: [], supporting: 0, total: 0 });
    expect(summarizeCounts({})).toEqual({ rows: [], supporting: 0, total: 0 });
  });

  it('takes a Map, and a hostile type name cannot reach the prototype', () => {
    const summary = summarizeCounts(new Map([['__proto__', 2]]));
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].type).toBe('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('countItemsByType() and sumCounts()', () => {
  it('counts plan items by type', () => {
    const counts = countItemsByType([makeItem('Request'), makeItem('Request'), makeItem('Environment')]);
    expect(Object.fromEntries(counts)).toEqual({ Request: 2, Environment: 1 });
    expect(countItemsByType(NOTHING).size).toBe(0);
  });

  it('adds up counts from several reports', () => {
    const sum = sumCounts([{ Request: 3, Environment: 1 }, NOTHING, { Request: 2, Project: 1 }]);
    expect(Object.fromEntries(sum)).toEqual({ Request: 5, Environment: 1, Project: 1 });
  });
});

describe('describeItems()', () => {
  it('names the content kinds before the containers', () => {
    const items = [
      makeItem('Project'),
      makeItem('Workspace'),
      makeItem('Request'),
      makeItem('Request'),
      makeItem('RequestGroup'),
      makeItem('Environment'),
    ];
    expect(describeItems(items)).toBe('1 folder, 2 requests, 1 environment');
  });

  it('keeps it short', () => {
    const items = ['RequestGroup', 'Request', 'Environment', 'CookieJar', 'ApiSpec'].map(type => makeItem(type));
    expect(describeItems(items, 2)).toBe('1 folder, 1 request');
  });

  it('falls back to the containers, then to nothing', () => {
    expect(describeItems([makeItem('Project')])).toBe('1 project');
    expect(describeItems([])).toBe('Nothing to copy');
  });
});

describe('groupEntries()', () => {
  it('orders groups by reason, whatever order the entries arrive in', () => {
    const groups = groupEntries([
      makeEntry({ reason: 'already-imported' }),
      makeEntry({ reason: 'parse-error' }),
      makeEntry({ reason: 'git-project' }),
      makeEntry({ reason: 'secret-not-readable' }),
    ]);
    expect(groups.map(group => group.reason)).toEqual([
      'parse-error',
      'git-project',
      'secret-not-readable',
      'already-imported',
    ]);
  });

  it('uses the plain English title and hint of each reason', () => {
    const [group] = groupEntries([makeEntry({ reason: 'cloud-only' })]);
    expect(group.title).toBe(REASON_INFO['cloud-only'].title);
    expect(group.hint).toBe(REASON_INFO['cloud-only'].hint);
  });

  it('keeps the order of entries inside a group', () => {
    const entries = ['c', 'a', 'b'].map(name => makeEntry({ name }));
    expect(groupEntries(entries)[0].entries.map(entry => entry.name)).toEqual(['c', 'a', 'b']);
  });

  it('gives a reason it does not know its own group at the end', () => {
    const entries = [
      makeEntry({ reason: 'future-reason' as ReportEntry['reason'] }),
      makeEntry({ reason: 'not-supported' }),
    ];
    const groups = groupEntries(entries);
    expect(groups.map(group => group.reason)).toEqual(['not-supported', 'future-reason']);
    expect(groups[1].title).toBe('Future reason');
  });

  it('never drops an entry', () => {
    const entries = [
      ...Array.from({ length: 7 }, () => makeEntry({ reason: 'already-imported' })),
      ...Array.from({ length: 3 }, () => makeEntry({ reason: 'file-missing' })),
      makeEntry({ reason: 'weird' as ReportEntry['reason'] }),
    ];
    const total = groupEntries(entries).reduce((sum, group) => sum + group.entries.length, 0);
    expect(total).toBe(entries.length);
  });

  it('returns nothing for nothing', () => {
    expect(groupEntries([])).toEqual([]);
    expect(groupEntries(NOTHING)).toEqual([]);
  });

  it('keeps extra fields on the entries', () => {
    const [group] = groupEntries(withOrigin([makeEntry()], 'Shop API'));
    expect(group.entries[0].origin).toBe('Shop API');
  });
});

describe('keyEntries()', () => {
  it('gives equal entries different keys', () => {
    const keys = keyEntries([makeEntry(), makeEntry(), makeEntry({ name: 'Other' })]).map(item => item.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('gives the same keys for the same input', () => {
    const entries = [makeEntry(), makeEntry()];
    expect(keyEntries(entries).map(item => item.key)).toEqual(keyEntries(entries).map(item => item.key));
  });
});

describe('planTitle()', () => {
  it('names an Insomnia or Insomnium plan after the app', () => {
    expect(planTitle(makePlan())).toBe('Insomnia');
    expect(planTitle(makePlan({ source: makeSource({ kind: 'insomnium' }) }))).toBe('Insomnium');
  });

  it('names a Bruno plan after its collection', () => {
    const plan = makePlan({
      source: makeSource({ kind: 'bruno', path: '/work/shop-api' }),
      items: [makeItem('Project', 'Shop project'), makeItem('Workspace', 'Shop API')],
    });
    expect(planTitle(plan)).toBe('Shop API');
  });

  it('falls back to the project, then to the folder name', () => {
    const source = makeSource({ kind: 'bruno', path: '/work/shop-api/' });
    expect(planTitle(makePlan({ source, items: [makeItem('Project', 'Shop project')] }))).toBe('Shop project');
    expect(planTitle(makePlan({ source }))).toBe('shop-api');
    expect(planTitle(makePlan({ source: { ...source, path: 'C:\\work\\billing' } }))).toBe('billing');
    expect(planTitle(makePlan({ source: { ...source, path: '' } }))).toBe('Untitled');
  });
});

describe('withOrigin()', () => {
  it('tags entries with the collection they came from', () => {
    expect(withOrigin([makeEntry()], 'Shop API')[0].origin).toBe('Shop API');
  });

  it('copies the entries and leaves them untouched without an origin', () => {
    const entry = makeEntry();
    const [copy] = withOrigin([entry], NOTHING);
    expect(copy).toEqual(entry);
    expect(copy).not.toBe(entry);
    expect(copy).not.toHaveProperty('origin');
    expect(withOrigin(NOTHING, 'x')).toEqual([]);
  });
});

describe('commonFolder()', () => {
  it('finds the folder that holds several collections', () => {
    expect(commonFolder(['/home/me/work/shop-api', '/home/me/work/billing-api', '/home/me/work/search/api'])).toBe(
      '/home/me/work',
    );
  });

  it('works with Windows paths', () => {
    expect(commonFolder(['C:\\work\\shop', 'C:\\work\\billing'])).toBe('C:\\work');
  });

  it('does not match half of a folder name', () => {
    expect(commonFolder(['/work/shop-api', '/work/shop-web'])).toBe('/work');
  });

  it('returns the path itself for a single path', () => {
    expect(commonFolder(['/home/me/work/shop-api'])).toBe('/home/me/work/shop-api');
  });

  it('returns nothing when only the root is shared', () => {
    expect(commonFolder(['/a/one', '/b/two'])).toBe('');
    expect(commonFolder(['C:\\one', 'D:\\two'])).toBe('');
    expect(commonFolder([])).toBe('');
  });
});

describe('collectPlugins()', () => {
  it('lists each package once, sorted', () => {
    const plans = [
      makePlan({ plugins: ['insomnia-plugin-b', 'insomnia-plugin-a'] }),
      makePlan({ plugins: ['insomnia-plugin-a', ' insomnia-plugin-c '] }),
    ];
    expect(collectPlugins(plans)).toEqual(['insomnia-plugin-a', 'insomnia-plugin-b', 'insomnia-plugin-c']);
  });

  it('ignores empty and broken names', () => {
    const plans = [makePlan({ plugins: ['', '  ', 42 as unknown as string, 'insomnia-plugin-a'] })];
    expect(collectPlugins(plans)).toEqual(['insomnia-plugin-a']);
  });

  it('is empty when no plan found a plugin', () => {
    expect(collectPlugins([makePlan(), makePlan()])).toEqual([]);
    expect(collectPlugins([])).toEqual([]);
  });
});
