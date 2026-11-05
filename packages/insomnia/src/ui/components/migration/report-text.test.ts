import { describe, expect, it } from 'vitest';

import type { CommitResult } from './flow';
import { QUIET_SKIPS_NOTE, REASON_INFO } from './labels';
import { addedCount, entryLine, formatReportText, reportHeadline } from './report-text';
import { makeEntry, makeItem, makePlan, makeReport, makeSource } from './test-fixtures';

const success = (overrides: Parameters<typeof makeReport>[0] = {}, plan = makePlan()): CommitResult => ({
  ok: true,
  plan,
  report: makeReport({ source: plan.source, ...overrides }),
});

const failure = (error: string, plan = makePlan()): CommitResult => ({ ok: false, plan, error });

describe('entryLine()', () => {
  it('shows the name, the kind and the detail', () => {
    expect(entryLine(makeEntry({ name: 'Get users', detail: 'uses req.setUrl' }))).toBe(
      '- Get users (request): uses req.setUrl',
    );
  });

  it('adds the collection when there is one', () => {
    expect(entryLine({ ...makeEntry(), origin: 'Shop API' })).toBe('- Get users (request) [Shop API]');
  });

  it('copes with an entry that has no name', () => {
    expect(entryLine(makeEntry({ name: '' }))).toBe('- (no name) (request)');
  });
});

describe('formatReportText()', () => {
  it('starts with the product name in lowercase and names the source', () => {
    const text = formatReportText([success()]);
    expect(text.split('\n')[0]).toBe('restless migration report');
    expect(text).toContain('Insomnia (Insomnia, /home/me/.config/Insomnia)');
    expect(text).toContain('Started: 2026-11-05T10:00:00.000Z');
    expect(text).toContain('Finished: 2026-11-05T10:00:03.000Z');
  });

  it('lists what was added, with the view settings as one line', () => {
    const text = formatReportText([success({ imported: { Request: 12, RequestGroup: 1, RequestMeta: 12 } })]);
    expect(text).toContain('Added:\n  1 folder\n  12 requests\n  12 view settings');
  });

  it('says so when nothing was added', () => {
    expect(formatReportText([success()])).toContain('Added:\n  Nothing was added');
  });

  it('groups what was skipped under plain English headings', () => {
    const text = formatReportText([
      success({
        entries: [
          makeEntry({
            reason: 'git-project',
            type: 'Project',
            name: 'Billing repo',
            detail: 'folder /home/me/billing',
          }),
          makeEntry({ reason: 'secret-not-readable', type: 'Environment', name: 'Prod' }),
          makeEntry({ reason: 'secret-not-readable', type: 'Environment', name: 'Staging' }),
        ],
      }),
    ]);
    expect(text).toContain('Skipped or needs a check:');
    expect(text).toContain(`Git projects (1)\n  ${REASON_INFO['git-project'].hint}`);
    expect(text).toContain('  - Billing repo (project): folder /home/me/billing');
    expect(text).toContain('Secrets not copied (2)');
    expect(text.indexOf('Git projects')).toBeLessThan(text.indexOf('Secrets not copied'));
  });

  it('leaves out the skipped section when nothing was skipped', () => {
    expect(formatReportText([success()])).not.toContain('Skipped or needs a check');
  });

  it('lists a failed plan with its error and how to recover', () => {
    const text = formatReportText([failure('Disk is full')]);
    expect(text).toContain('Failed: Disk is full');
    expect(text).toContain('Items already added are skipped.');
  });

  it('writes one block per plan, named after the collection', () => {
    const shop = makePlan({
      source: makeSource({ kind: 'bruno', path: '/work/shop', id: 'bruno:/work/shop' }),
      items: [makeItem('Workspace', 'Shop API')],
    });
    const billing = makePlan({
      source: makeSource({ kind: 'bruno', path: '/work/billing', id: 'bruno:/work/billing' }),
      items: [makeItem('Workspace', 'Billing API')],
    });
    const text = formatReportText([success({}, shop), failure('Broken file', billing)]);
    expect(text).toContain('Shop API (Bruno, /work/shop)');
    expect(text).toContain('Billing API (Bruno, /work/billing)\nFailed: Broken file');
  });

  it('mentions what is left behind on purpose for Insomnia and Insomnium, not for Bruno', () => {
    expect(formatReportText([success()])).toContain(QUIET_SKIPS_NOTE);
    const bruno = makePlan({ source: makeSource({ kind: 'bruno', path: '/work/shop', id: 'bruno:/work/shop' }) });
    expect(formatReportText([success({}, bruno)])).not.toContain(QUIET_SKIPS_NOTE);
  });

  it('never carries the documents of the plan', () => {
    const plan = makePlan({
      items: [makeItem('Request', 'Login', { authentication: { password: 'hunter2' }, url: 'https://example.test' })],
    });
    const text = formatReportText([success({ imported: { Request: 1 } }, plan)]);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('example.test');
  });

  it('does not use dashes as punctuation', () => {
    const text = formatReportText([
      success({
        entries: [makeEntry({ reason: 'script-partly-translated' }), makeEntry({ reason: 'already-imported' })],
      }),
      failure('Broken'),
    ]);
    expect(text).not.toContain('—');
    expect(text).not.toContain('–');
  });

  it('keeps every entry, however many there are', () => {
    const entries = Array.from({ length: 250 }, (_, number) =>
      makeEntry({ reason: 'already-imported', name: `Request ${number}` }),
    );
    const text = formatReportText([success({ entries })]);
    expect(text).toContain('Already in restless (250)');
    expect(text).toContain('- Request 0 (request)');
    expect(text).toContain('- Request 249 (request)');
  });
});

describe('addedCount()', () => {
  it('adds up what was imported and leaves out the view settings', () => {
    const results = [
      success({ imported: { Request: 3, RequestMeta: 3, Environment: 1 } }),
      success({ imported: { Request: 2 } }),
      failure('Nope'),
    ];
    expect(addedCount(results)).toBe(6);
  });
});

describe('reportHeadline()', () => {
  it('says it went well and how much was added', () => {
    expect(reportHeadline([success({ imported: { Request: 5, Environment: 1 } })])).toEqual({
      tone: 'success',
      title: 'Import finished',
      detail: '6 items added.',
    });
  });

  it('uses the singular for one item', () => {
    expect(reportHeadline([success({ imported: { Request: 1 } })]).detail).toBe('1 item added.');
  });

  it('warns when nothing was added', () => {
    const headline = reportHeadline([success({ entries: [makeEntry({ reason: 'already-imported' })] })]);
    expect(headline.tone).toBe('warning');
    expect(headline.title).toBe('Nothing was added');
  });

  it('warns when some plans failed and the rest went through', () => {
    const headline = reportHeadline([success({ imported: { Request: 2 } }), failure('Broken'), failure('Broken too')]);
    expect(headline).toEqual({
      tone: 'warning',
      title: 'Import finished with errors',
      detail: '2 of 3 could not be imported. The rest went through.',
    });
  });

  it('reports an error when every plan failed, and says to run it again', () => {
    const headline = reportHeadline([failure('Broken')]);
    expect(headline.tone).toBe('error');
    expect(headline.title).toBe('The import failed');
    expect(headline.detail).toContain('Run it again');
  });
});
