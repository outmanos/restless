/**
 * @vitest-environment jsdom
 */
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactRouter from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MigrationPlan } from '~/main/migration/types';

import { MigrationModal, type MigrationModalHandle, type MigrationModalOptions } from './migration-modal';
import { DASHES, makeEntry, makeItem, makePlan, makeReport, makeSource, NOTHING } from './test-fixtures';

// The modal only needs a router for these three things, so they are replaced instead of mounting one.
const revalidate = vi.fn();
const patchSettings = vi.fn();
let seenOffer = false;

vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useRevalidator: () => ({ revalidate, state: 'idle' }),
}));
vi.mock('~/ui/hooks/use-request', () => ({ useSettingsPatcher: () => patchSettings }));
vi.mock('~/ui/hooks/use-root-loader-data', () => ({
  useRootLoaderData: () => ({ settings: { hasSeenMigrationOffer: seenOffer } }),
}));
// The plugin list reloads templating after an install, which would start a worker.
vi.mock('~/ui/templating/renderer-safe', () => ({ reload: vi.fn() }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// The app and the shared components use the automatic JSX runtime that Vite's React plugin provides.
// Vitest here transforms JSX the classic way, which needs React in scope when a component renders.
(globalThis as Record<string, unknown>).React = React;

const bridge = {
  migrationDetect: vi.fn(),
  migrationPlanInsomnia: vi.fn(),
  migrationPlanBruno: vi.fn(),
  migrationCommit: vi.fn(),
  installPlugin: vi.fn(),
  plugins: { reloadPlugins: vi.fn() },
};
const showOpenDialog = vi.fn();
const writeText = vi.fn();

let container: HTMLDivElement;
let root: Root;
const handle = createRef<MigrationModalHandle>();

const find = (testId: string) => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const text = () => document.body.textContent ?? '';

// Lets pending promises and effects finish. React Aria and the flow both chain a few of them.
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

const click = async (testId: string) => {
  const element = find(testId);
  expect(element, `no element with test id ${testId}`).not.toBeNull();
  await act(async () => {
    element!.click();
  });
  await settle();
};

const pressEscape = async () => {
  const dialog = document.body.querySelector('[role="dialog"]');
  expect(dialog, 'no dialog to press Escape in').not.toBeNull();
  await act(async () => {
    dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
};

const open = async (options?: MigrationModalOptions) => {
  await act(async () => {
    handle.current!.show(options);
  });
  await settle();
};

const brunoPlan = (name: string, extra: Partial<MigrationPlan> = {}): MigrationPlan =>
  makePlan({
    source: makeSource({ kind: 'bruno', id: `bruno:/work/${name}`, path: `/work/${name}` }),
    items: [makeItem('Project', name), makeItem('Workspace', name), makeItem('Request', 'Get users')],
    ...extra,
  });

beforeEach(() => {
  seenOffer = false;
  vi.clearAllMocks();
  Object.assign(window, { main: bridge, dialog: { showOpenDialog }, clipboard: { writeText } });
  bridge.migrationDetect.mockResolvedValue([]);
  bridge.migrationCommit.mockImplementation(async (plan: MigrationPlan) =>
    makeReport({ source: plan.source, imported: { Request: 1 } }),
  );
  bridge.installPlugin.mockResolvedValue(NOTHING);
  bridge.plugins.reloadPlugins.mockResolvedValue(NOTHING);
  writeText.mockResolvedValue(NOTHING);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<MigrationModal ref={handle} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('opening', () => {
  it('renders nothing until it is asked to open', () => {
    expect(find('migration-modal')).toBeNull();
    expect(bridge.migrationDetect).not.toHaveBeenCalled();
  });

  it('looks for installs when opened and lists what it finds', async () => {
    const sources = [
      makeSource(),
      makeSource({
        kind: 'insomnium',
        id: 'insomnium:/x',
        path: '/x',
        counts: { projects: 0, collections: 1, requests: 4, environments: 0 },
      }),
    ];
    bridge.migrationDetect.mockResolvedValue(sources);
    await open();
    expect(bridge.migrationDetect).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Migrate to restless');
    expect(find('migration-source-insomnia')?.textContent).toContain(
      '1 project, 2 collections, 10 requests, 1 environment',
    );
    expect(find('migration-source-insomnium')?.textContent).toContain('/x');
  });

  it('says so when nothing is found, and still offers Bruno', async () => {
    await open();
    expect(find('migration-none-found')).not.toBeNull();
    expect(find('migration-choose-bruno')).not.toBeNull();
  });

  it('warns when the app looks like it is open', async () => {
    bridge.migrationDetect.mockResolvedValue([
      makeSource({ running: true }),
      makeSource({ kind: 'insomnium', id: 'insomnium:/x', path: '/x' }),
    ]);
    await open();
    expect(find('migration-source-insomnia')?.textContent).toContain('Insomnia seems to be open. Close it first');
    expect(find('migration-source-insomnium')?.textContent).not.toContain('seems to be open');
    // A warning, not a block: it can still be reviewed.
    expect((find('migration-review-insomnia') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an error with a way to try again when the look fails', async () => {
    bridge.migrationDetect.mockRejectedValueOnce(new Error('Not implemented')).mockResolvedValueOnce([makeSource()]);
    await open();
    expect(find('migration-detect-error')?.textContent).toContain('Not implemented');
    expect(find('migration-looking')).toBeNull();
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent === 'Try again')!
        .click();
    });
    await settle();
    expect(find('migration-detect-error')).toBeNull();
    expect(find('migration-source-insomnia')).not.toBeNull();
  });

  it('does not look again when the installs are handed in', async () => {
    await open({ offer: true, sources: [makeSource()] });
    expect(bridge.migrationDetect).not.toHaveBeenCalled();
    expect(find('migration-source-insomnia')).not.toBeNull();
  });

  it('keeps what is on screen when asked to open again', async () => {
    bridge.migrationDetect.mockResolvedValue([makeSource()]);
    await open();
    await open({ offer: true });
    expect(bridge.migrationDetect).toHaveBeenCalledTimes(1);
  });
});

describe('the first-launch offer', () => {
  it('reads as an offer and can be declined with Not now, which is remembered', async () => {
    await open({ offer: true, sources: [makeSource()] });
    expect(text()).toContain('restless found another app on this computer');
    expect(text()).toContain('File > Migrate from…');
    expect(find('migration-close')?.textContent).toBe('Not now');
    await click('migration-close');
    expect(find('migration-modal')).toBeNull();
    expect(patchSettings).toHaveBeenCalledWith({ hasSeenMigrationOffer: true });
  });

  it('is remembered when closed any other way too', async () => {
    await open({ offer: true, sources: [makeSource()] });
    await act(async () => {
      handle.current!.hide();
    });
    expect(find('migration-modal')).toBeNull();
    expect(patchSettings).toHaveBeenCalledWith({ hasSeenMigrationOffer: true });
  });

  it('does not write the setting twice once it is set', async () => {
    seenOffer = true;
    await open({ offer: true, sources: [makeSource()] });
    await click('migration-close');
    expect(patchSettings).not.toHaveBeenCalled();
  });

  it('is remembered when closed with Escape', async () => {
    await open({ offer: true, sources: [makeSource()] });
    await pressEscape();
    expect(find('migration-modal')).toBeNull();
    expect(patchSettings).toHaveBeenCalledWith({ hasSeenMigrationOffer: true });
  });

  it('is not an offer when opened from the menu', async () => {
    await open();
    expect(text()).not.toContain('restless found another app');
    expect(find('migration-close')?.textContent).toBe('Close');
  });
});

describe('reviewing and importing from Insomnia', () => {
  const plan = makePlan({
    items: [
      makeItem('Project', 'Shop'),
      makeItem('Workspace', 'Shop API'),
      makeItem('Request', 'Get users'),
      makeItem('Request', 'Add user'),
      makeItem('RequestMeta', 'Get users'),
    ],
    issues: [
      makeEntry({ reason: 'git-project', type: 'Project', name: 'Billing repo', detail: 'folder /home/me/billing' }),
      makeEntry({ reason: 'secret-not-readable', type: 'Environment', name: 'Prod' }),
    ],
  });

  beforeEach(() => {
    bridge.migrationDetect.mockResolvedValue([makeSource()]);
    bridge.migrationPlanInsomnia.mockResolvedValue(plan);
  });

  it('shows what will move and what will not, and writes nothing yet', async () => {
    await open();
    await click('migration-review-insomnia');
    expect(bridge.migrationPlanInsomnia).toHaveBeenCalledWith(expect.objectContaining({ kind: 'insomnia' }));
    expect(find('migration-modal')?.dataset.step).toBe('review');
    expect(find('migration-review-counts')?.textContent).toContain('2 requests');
    expect(find('migration-review-counts')?.textContent).toContain('1 project');
    expect(find('migration-review-counts')?.textContent).toContain('Plus 1 view settings');
    const issues = find('migration-review-issues')?.textContent ?? '';
    expect(issues).toContain('Git projects');
    expect(issues).toContain('Secrets not copied');
    expect(issues).toContain('Billing repo');
    expect(text()).toContain('Nothing is written until you click Import');
    expect(bridge.migrationCommit).not.toHaveBeenCalled();
  });

  it('moves focus into the content on each step instead of leaving it on the close button', async () => {
    await open();
    expect(document.activeElement).toBe(find('migration-modal'));
    await click('migration-review-insomnia');
    expect(find('migration-modal')?.dataset.step).toBe('review');
    expect(document.activeElement).toBe(find('migration-modal'));
    await click('migration-import');
    expect(find('migration-modal')?.dataset.step).toBe('report');
    expect(document.activeElement).toBe(find('migration-modal'));
  });

  it('goes back to the first step without importing', async () => {
    await open();
    await click('migration-review-insomnia');
    await click('migration-back');
    expect(find('migration-modal')?.dataset.step).toBe('detect');
    expect(find('migration-source-insomnia')).not.toBeNull();
    expect(bridge.migrationCommit).not.toHaveBeenCalled();
  });

  it('shows the error and stays on the first step when reading fails', async () => {
    bridge.migrationPlanInsomnia.mockRejectedValue(new Error('Cannot read the folder'));
    await open();
    await click('migration-review-insomnia');
    expect(find('migration-modal')?.dataset.step).toBe('detect');
    expect(find('migration-read-error')?.textContent).toContain('Cannot read the folder');
    // Not stuck: the button works again.
    expect((find('migration-review-insomnia') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says nothing was added, in report words, when everything was already there', async () => {
    bridge.migrationCommit.mockResolvedValue(
      makeReport({ entries: [makeEntry({ reason: 'already-imported', name: 'Get users' })] }),
    );
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    expect(find('migration-headline')?.textContent).toContain('Nothing was added');
    expect(find('migration-report-counts')?.textContent).toContain('Nothing was added.');
    expect(find('migration-report-counts')?.textContent).not.toContain('Nothing to copy');
  });

  it('commits the plan it showed, then shows the report and refreshes the data', async () => {
    bridge.migrationCommit.mockResolvedValue(
      makeReport({
        imported: { Project: 1, Workspace: 1, Request: 2, RequestMeta: 1 },
        entries: [
          makeEntry({
            reason: 'git-project',
            type: 'Project',
            name: 'Billing repo',
            detail: 'folder /home/me/billing',
          }),
        ],
      }),
    );
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    expect(bridge.migrationCommit).toHaveBeenCalledTimes(1);
    expect(bridge.migrationCommit).toHaveBeenCalledWith(plan);
    expect(find('migration-modal')?.dataset.step).toBe('report');
    expect(find('migration-headline')?.textContent).toContain('Import finished');
    expect(find('migration-headline')?.textContent).toContain('4 items added.');
    expect(find('migration-report-counts')?.textContent).toContain('2 requests');
    expect(find('migration-group-git-project')?.textContent).toContain('Billing repo');
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('copies the report as text', async () => {
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    await click('migration-copy-report');
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith('restless migration report')).toBe(true);
    expect(copied).toContain('Added:');
    expect(find('migration-copy-report')?.textContent).toContain('Copied');
  });

  it('says so when copying fails', async () => {
    writeText.mockRejectedValue(new Error('No clipboard'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    await click('migration-copy-report');
    expect(find('migration-copy-report')?.textContent).toContain('Could not copy');
    warn.mockRestore();
  });

  it('shows a failed import as a result, not a spinner, and still refreshes', async () => {
    bridge.migrationCommit.mockRejectedValue(new Error('Disk is full'));
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    expect(find('migration-importing')).toBeNull();
    expect(find('migration-modal')?.dataset.step).toBe('report');
    expect(find('migration-headline')?.textContent).toContain('The import did not finish');
    expect(find('migration-report-failures')?.textContent).toContain('Disk is full');
    expect(revalidate).toHaveBeenCalledTimes(1);
    // The window can be closed again.
    await click('migration-done');
    expect(find('migration-modal')).toBeNull();
  });

  it('says there is no report and that trying again is safe, and shows only what is true', async () => {
    bridge.migrationCommit.mockRejectedValue(new Error('Could not back up restless first: no space left'));
    bridge.migrationPlanInsomnia.mockResolvedValue(
      makePlan({ items: [makeItem('Request')], plugins: ['insomnia-plugin-faker'] }),
    );
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    const headline = find('migration-headline')?.textContent ?? '';
    expect(headline).toContain('No report was written');
    expect(headline).toContain('Trying again is safe');
    expect(headline).toContain('nothing is overwritten');
    expect(find('migration-report-failures')?.textContent).toContain('Could not back up restless first: no space left');
    // There is nothing to show for a report that does not exist.
    expect(find('migration-report-counts')).toBeNull();
    expect(find('migration-report-issues')).toBeNull();
    expect(find('migration-plugins')).toBeNull();
    expect(text()).not.toContain('saves a copy of this report');
    expect(text()).not.toContain('Nothing was left out');
    // The way forward is one click away.
    expect(find('migration-retry')?.textContent).toBe('Try again');
  });

  it('tries again with the same plan, without going back through the review', async () => {
    bridge.migrationCommit
      .mockRejectedValueOnce(new Error('The database is locked'))
      .mockResolvedValueOnce(makeReport({ imported: { Request: 3 } }));
    bridge.migrationPlanInsomnia.mockResolvedValue(makePlan({ items: [makeItem('Request')] }));
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    expect(find('migration-headline')?.textContent).toContain('The import did not finish');
    await click('migration-retry');
    expect(bridge.migrationCommit).toHaveBeenCalledTimes(2);
    expect(bridge.migrationPlanInsomnia).toHaveBeenCalledTimes(1);
    expect(find('migration-modal')?.dataset.step).toBe('report');
    expect(find('migration-headline')?.textContent).toContain('Import finished');
    expect(find('migration-report-counts')?.textContent).toContain('3 requests');
    expect(find('migration-report-failures')).toBeNull();
    expect(find('migration-retry')).toBeNull();
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it('can be tried again as often as it takes, and the window is locked while it runs', async () => {
    let finish: (value: ReturnType<typeof makeReport>) => void = () => {};
    bridge.migrationCommit
      .mockRejectedValueOnce(new Error('The database is locked'))
      .mockRejectedValueOnce(new Error('The database is still locked'))
      .mockReturnValueOnce(new Promise(resolve => (finish = resolve)));
    bridge.migrationPlanInsomnia.mockResolvedValue(makePlan({ items: [makeItem('Request')] }));
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    await click('migration-retry');
    expect(find('migration-report-failures')?.textContent).toContain('The database is still locked');
    expect(find('migration-retry')).not.toBeNull();
    await click('migration-retry');
    expect(find('migration-importing')).not.toBeNull();
    await act(async () => {
      handle.current!.hide();
    });
    expect(find('migration-modal')).not.toBeNull();
    await act(async () => {
      finish(makeReport({ imported: { Request: 1 } }));
    });
    await settle();
    expect(find('migration-headline')?.textContent).toContain('Import finished');
  });

  it('retries only the collections that failed and keeps the ones that went through', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work'] });
    bridge.migrationPlanBruno.mockResolvedValue([brunoPlan('shop'), brunoPlan('billing'), brunoPlan('search')]);
    bridge.migrationCommit.mockImplementation(async (plan: MigrationPlan) => {
      if (plan.source.id === 'bruno:/work/billing' && bridge.migrationCommit.mock.calls.length <= 3) {
        throw new Error('Broken file');
      }
      return makeReport({ source: plan.source, imported: { Request: 1 } });
    });
    await open();
    await click('migration-choose-bruno');
    await click('migration-import');
    expect(find('migration-headline')?.textContent).toContain('Import finished with errors');
    expect(find('migration-headline')?.textContent).toContain('Trying again is safe');
    expect(find('migration-report-counts')?.textContent).toContain('2 requests');
    await click('migration-retry');
    const retried = bridge.migrationCommit.mock.calls.slice(3).map(call => (call[0] as MigrationPlan).source.id);
    expect(retried).toEqual(['bruno:/work/billing']);
    expect(find('migration-headline')?.textContent).toContain('Import finished');
    expect(find('migration-report-counts')?.textContent).toContain('3 requests');
    expect(find('migration-report-failures')).toBeNull();
  });

  it('can start over after a report', async () => {
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
    await click('migration-restart');
    expect(find('migration-modal')?.dataset.step).toBe('detect');
    expect(find('migration-source-insomnia')).not.toBeNull();
  });

  it('cannot import when the plan has nothing in it', async () => {
    bridge.migrationPlanInsomnia.mockResolvedValue(makePlan());
    await open();
    await click('migration-review-insomnia');
    expect((find('migration-import') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('Nothing to copy.');
  });

  it('cannot be closed while the import runs, and can be afterwards', async () => {
    let finish: (value: ReturnType<typeof makeReport>) => void = () => {};
    bridge.migrationCommit.mockReturnValue(new Promise(resolve => (finish = resolve)));
    await open();
    // The X is there before the import starts...
    expect(document.body.querySelector('svg[data-icon="x"]')).not.toBeNull();
    await click('migration-review-insomnia');
    await click('migration-import');
    expect(find('migration-importing')).not.toBeNull();
    // ...and gone while it runs, with no way out from the shell or the keyboard either.
    expect(document.body.querySelector('svg[data-icon="x"]')).toBeNull();
    await act(async () => {
      handle.current!.hide();
    });
    expect(find('migration-modal')).not.toBeNull();
    expect(find('migration-modal')?.dataset.step).toBe('importing');
    await pressEscape();
    expect(find('migration-modal')).not.toBeNull();

    await act(async () => {
      finish(makeReport({ imported: { Request: 1 } }));
    });
    await settle();
    expect(find('migration-modal')?.dataset.step).toBe('report');
    await click('migration-done');
    expect(find('migration-modal')).toBeNull();
  });

  it('refuses a second import click while one runs', async () => {
    let finish: (value: ReturnType<typeof makeReport>) => void = () => {};
    bridge.migrationCommit.mockReturnValue(new Promise(resolve => (finish = resolve)));
    await open();
    await click('migration-review-insomnia');
    const importButton = find('migration-import')!;
    await act(async () => {
      importButton.click();
      importButton.click();
    });
    await settle();
    expect(bridge.migrationCommit).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(makeReport());
    });
    await settle();
  });
});

describe('Bruno', () => {
  it('reads a folder with several collections and imports them one by one', async () => {
    const plans = [brunoPlan('shop'), brunoPlan('billing'), brunoPlan('search')];
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work'] });
    bridge.migrationPlanBruno.mockResolvedValue(plans);
    await open();
    await click('migration-choose-bruno');
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'] }));
    expect(bridge.migrationPlanBruno).toHaveBeenCalledWith('/work');
    expect(find('migration-review-title')?.textContent).toBe('3 collections found');
    expect(find('migration-review-plans')?.textContent).toContain('shop');
    expect(find('migration-review-plans')?.textContent).toContain('billing');
    expect(find('migration-review-plans')?.textContent).toContain('search');

    await click('migration-import');
    expect(bridge.migrationCommit.mock.calls.map(call => (call[0] as MigrationPlan).source.id)).toEqual([
      'bruno:/work/shop',
      'bruno:/work/billing',
      'bruno:/work/search',
    ]);
    expect(find('migration-report-counts')?.textContent).toContain('3 requests');
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the folder dialog is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await open();
    await click('migration-choose-bruno');
    expect(bridge.migrationPlanBruno).not.toHaveBeenCalled();
    expect(find('migration-modal')?.dataset.step).toBe('detect');
    expect(find('migration-read-error')).toBeNull();
  });

  it('says so when the folder holds no collection', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/empty'] });
    bridge.migrationPlanBruno.mockResolvedValue([]);
    await open();
    await click('migration-choose-bruno');
    expect(find('migration-read-error')?.textContent).toContain('No Bruno collections were found in that folder.');
    expect(find('migration-modal')?.dataset.step).toBe('detect');
  });

  it('reports the collection that failed and the ones that did not', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/work'] });
    bridge.migrationPlanBruno.mockResolvedValue([brunoPlan('shop'), brunoPlan('billing')]);
    bridge.migrationCommit
      .mockResolvedValueOnce(makeReport({ imported: { Request: 1 } }))
      .mockRejectedValueOnce(new Error('Broken file'));
    await open();
    await click('migration-choose-bruno');
    await click('migration-import');
    expect(find('migration-headline')?.textContent).toContain('Import finished with errors');
    expect(find('migration-report-failures')?.textContent).toContain('billing');
    expect(find('migration-report-failures')?.textContent).toContain('Broken file');
    expect(find('migration-report-counts')?.textContent).toContain('1 request');
  });

  it('plans a Bruno source that detection found from its folder', async () => {
    const source = makeSource({ kind: 'bruno', id: 'bruno:/work/shop', path: '/work/shop' });
    bridge.migrationDetect.mockResolvedValue([source]);
    bridge.migrationPlanBruno.mockResolvedValue([brunoPlan('shop')]);
    await open();
    await click('migration-review-bruno');
    expect(bridge.migrationPlanBruno).toHaveBeenCalledWith('/work/shop');
    expect(bridge.migrationPlanInsomnia).not.toHaveBeenCalled();
  });
});

describe('plugins', () => {
  const withPlugins = (names: string[]) => {
    const plan = makePlan({ items: [makeItem('Request')], plugins: names });
    bridge.migrationDetect.mockResolvedValue([makeSource()]);
    bridge.migrationPlanInsomnia.mockResolvedValue(plan);
  };

  const toReport = async () => {
    await open();
    await click('migration-review-insomnia');
    await click('migration-import');
  };

  it('lists them after the report and downloads nothing until a button is clicked', async () => {
    withPlugins(['insomnia-plugin-faker', 'insomnia-plugin-uuid']);
    await toReport();
    expect(find('migration-plugins')?.textContent).toContain('downloaded from npm');
    expect(find('migration-plugin-install-insomnia-plugin-faker')?.textContent).toBe('Install from npm');
    expect(find('migration-plugin-install-insomnia-plugin-uuid')).not.toBeNull();
    expect(bridge.installPlugin).not.toHaveBeenCalled();
    expect(bridge.plugins.reloadPlugins).not.toHaveBeenCalled();
  });

  it('installs only the plugin whose button was clicked, then reloads plugins', async () => {
    withPlugins(['insomnia-plugin-faker', 'insomnia-plugin-uuid']);
    await toReport();
    await click('migration-plugin-install-insomnia-plugin-faker');
    expect(bridge.installPlugin).toHaveBeenCalledTimes(1);
    expect(bridge.installPlugin).toHaveBeenCalledWith('insomnia-plugin-faker', false);
    expect(bridge.plugins.reloadPlugins).toHaveBeenCalledTimes(1);
    expect(find('migration-plugin-done-insomnia-plugin-faker')?.textContent).toContain('Installed');
    expect(find('migration-plugin-install-insomnia-plugin-uuid')).not.toBeNull();
  });

  it('shows the error and lets the install be tried again', async () => {
    withPlugins(['insomnia-plugin-faker']);
    bridge.installPlugin.mockRejectedValueOnce(new Error('Network is down')).mockResolvedValueOnce(NOTHING);
    await toReport();
    await click('migration-plugin-install-insomnia-plugin-faker');
    expect(find('migration-plugin-insomnia-plugin-faker')?.textContent).toContain('Network is down');
    expect(find('migration-plugin-install-insomnia-plugin-faker')?.textContent).toBe('Try again');
    await click('migration-plugin-install-insomnia-plugin-faker');
    expect(find('migration-plugin-done-insomnia-plugin-faker')).not.toBeNull();
  });

  it('does not offer an install for a name that fails the check', async () => {
    withPlugins(['lodash']);
    await toReport();
    expect((find('migration-plugin-install-lodash') as HTMLButtonElement).disabled).toBe(true);
    expect(find('migration-plugin-lodash')?.textContent).toContain('Cannot be installed from here');
  });

  it('has no plugin section when none were found', async () => {
    withPlugins([]);
    await toReport();
    expect(find('migration-plugins')).toBeNull();
  });
});

describe('what it never shows', () => {
  it('does not put document contents on screen', async () => {
    const secretPlan = makePlan({
      items: [makeItem('Request', 'Login', { authentication: { password: 'hunter2' } })],
    });
    bridge.migrationDetect.mockResolvedValue([makeSource()]);
    bridge.migrationPlanInsomnia.mockResolvedValue(secretPlan);
    await open();
    await click('migration-review-insomnia');
    expect(text()).not.toContain('hunter2');
    await click('migration-import');
    expect(text()).not.toContain('hunter2');
  });

  it('writes the product name in lowercase and uses no dashes as punctuation on any step', async () => {
    const plan = makePlan({
      items: [makeItem('Request')],
      issues: [makeEntry({ reason: 'script-partly-translated' }), makeEntry({ reason: 'already-imported' })],
      plugins: ['insomnia-plugin-faker'],
    });
    bridge.migrationDetect.mockResolvedValue([makeSource({ running: true })]);
    bridge.migrationPlanInsomnia.mockResolvedValue(plan);
    const seen: string[] = [];
    await open();
    seen.push(text());
    await click('migration-review-insomnia');
    seen.push(text());
    await click('migration-import');
    seen.push(text());
    for (const screen of seen) {
      expect(screen).not.toContain('Restless');
      for (const dash of DASHES) {
        expect(screen).not.toContain(dash);
      }
    }
  });
});
