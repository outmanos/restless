import { describe, expect, it, vi } from 'vitest';

import type { MigrationPlan, MigrationReport } from '~/main/migration/types';

import {
  commitPlans,
  detectInstalls,
  errorMessage,
  type ImportProgress,
  installMigratedPlugin,
  pickBrunoFolder,
  planBrunoFolder,
  planSource,
  pluginNameProblem,
} from './flow';
import { makeItem, makePlan, makeReport, makeSource, NOTHING } from './test-fixtures';

const brunoPlan = (name: string): MigrationPlan =>
  makePlan({
    source: makeSource({ kind: 'bruno', id: `bruno:/work/${name}`, path: `/work/${name}` }),
    items: [makeItem('Workspace', name), makeItem('Request', 'Get users')],
  });

describe('errorMessage()', () => {
  it('uses the message of an error', () => {
    expect(errorMessage(new Error('Disk is full'))).toBe('Disk is full');
  });

  it('accepts a plain string', () => {
    expect(errorMessage('Disk is full')).toBe('Disk is full');
  });

  it('strips the prefix Electron adds to a remote error', () => {
    expect(errorMessage(new Error("Error invoking remote method 'migrationCommit': Error: Disk is full"))).toBe(
      'Disk is full',
    );
    expect(errorMessage(new Error("Error invoking remote method 'migrationCommit': Disk is full"))).toBe(
      'Disk is full',
    );
  });

  it('never returns an empty message', () => {
    expect(errorMessage(Object.assign(new Error('placeholder'), { message: '' }))).toBe('Something went wrong.');
    expect(errorMessage(NOTHING)).toBe('Something went wrong.');
    expect(errorMessage({ code: 1 }, 'The import failed.')).toBe('The import failed.');
  });
});

describe('detectInstalls()', () => {
  it('returns what the bridge found', async () => {
    const sources = [makeSource()];
    const api = { migrationDetect: vi.fn().mockResolvedValue(sources) };
    await expect(detectInstalls(api)).resolves.toEqual(sources);
    expect(api.migrationDetect).toHaveBeenCalledTimes(1);
  });

  it('treats a reply that is not a list as nothing found', async () => {
    const api = { migrationDetect: vi.fn().mockResolvedValue(NOTHING) };
    await expect(detectInstalls(api)).resolves.toEqual([]);
  });

  it('lets a failure through so the screen can show it', async () => {
    const api = { migrationDetect: vi.fn().mockRejectedValue(new Error('Not implemented')) };
    await expect(detectInstalls(api)).rejects.toThrow('Not implemented');
  });
});

describe('planSource()', () => {
  it('plans an Insomnia install with the install itself', async () => {
    const source = makeSource();
    const plan = makePlan({ source, items: [makeItem('Request')] });
    const api = { migrationPlanInsomnia: vi.fn().mockResolvedValue(plan), migrationPlanBruno: vi.fn() };
    await expect(planSource(api, source)).resolves.toEqual([plan]);
    expect(api.migrationPlanInsomnia).toHaveBeenCalledWith(source);
    expect(api.migrationPlanBruno).not.toHaveBeenCalled();
  });

  it('plans a Bruno source from its folder and keeps every plan', async () => {
    const source = makeSource({ kind: 'bruno', id: 'bruno:/work', path: '/work' });
    const plans = [brunoPlan('a'), brunoPlan('b')];
    const api = { migrationPlanInsomnia: vi.fn(), migrationPlanBruno: vi.fn().mockResolvedValue(plans) };
    await expect(planSource(api, source)).resolves.toEqual(plans);
    expect(api.migrationPlanBruno).toHaveBeenCalledWith('/work');
    expect(api.migrationPlanInsomnia).not.toHaveBeenCalled();
  });

  it('fills in lists that are missing from a plan', async () => {
    const source = makeSource();
    const broken = { source } as unknown as MigrationPlan;
    const api = { migrationPlanInsomnia: vi.fn().mockResolvedValue(broken), migrationPlanBruno: vi.fn() };
    const [plan] = await planSource(api, source);
    expect(plan).toEqual({ source, items: [], issues: [], plugins: [] });
  });

  it('fails clearly when nothing comes back', async () => {
    const api = { migrationPlanInsomnia: vi.fn().mockResolvedValue(NOTHING), migrationPlanBruno: vi.fn() };
    await expect(planSource(api, makeSource())).rejects.toThrow('The migration returned nothing to review.');
  });

  it('lets a failure through', async () => {
    const api = {
      migrationPlanInsomnia: vi.fn().mockRejectedValue(new Error('Cannot read the folder')),
      migrationPlanBruno: vi.fn(),
    };
    await expect(planSource(api, makeSource())).rejects.toThrow('Cannot read the folder');
  });
});

describe('planBrunoFolder()', () => {
  it('returns one plan per collection found', async () => {
    const plans = [brunoPlan('a'), brunoPlan('b'), brunoPlan('c')];
    const api = { migrationPlanBruno: vi.fn().mockResolvedValue(plans) };
    await expect(planBrunoFolder(api, '/work')).resolves.toHaveLength(3);
    expect(api.migrationPlanBruno).toHaveBeenCalledWith('/work');
  });

  it('returns an empty list when the folder holds no collection', async () => {
    await expect(planBrunoFolder({ migrationPlanBruno: vi.fn().mockResolvedValue([]) }, '/empty')).resolves.toEqual([]);
    await expect(planBrunoFolder({ migrationPlanBruno: vi.fn().mockResolvedValue(null) }, '/empty')).resolves.toEqual(
      [],
    );
  });
});

describe('pickBrunoFolder()', () => {
  it('asks for a folder and returns the one chosen', async () => {
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/work/api'] }) };
    await expect(pickBrunoFolder(dialog)).resolves.toBe('/work/api');
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'] }));
  });

  it('returns null when the dialog is cancelled', async () => {
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) };
    await expect(pickBrunoFolder(dialog)).resolves.toBeNull();
  });

  it('returns null when no path comes back', async () => {
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [] }) };
    await expect(pickBrunoFolder(dialog)).resolves.toBeNull();
  });
});

describe('commitPlans()', () => {
  it('writes the plans one at a time, in order', async () => {
    let running = 0;
    let mostAtOnce = 0;
    const order: string[] = [];
    const api = {
      migrationCommit: vi.fn(async (plan: MigrationPlan) => {
        running += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        order.push(plan.source.id);
        await new Promise(resolve => setTimeout(resolve, 5));
        running -= 1;
        return makeReport({ source: plan.source });
      }),
    };
    const results = await commitPlans(api, [brunoPlan('a'), brunoPlan('b'), brunoPlan('c')]);
    expect(mostAtOnce).toBe(1);
    expect(order).toEqual(['bruno:/work/a', 'bruno:/work/b', 'bruno:/work/c']);
    expect(results.map(result => result.ok)).toEqual([true, true, true]);
  });

  it('returns the report next to its plan', async () => {
    const plan = makePlan();
    const report = makeReport({ imported: { Request: 4 } });
    const results = await commitPlans({ migrationCommit: vi.fn().mockResolvedValue(report) }, [plan]);
    expect(results).toEqual([{ ok: true, plan, report }]);
  });

  it('keeps going after a plan fails and reports the error of that plan', async () => {
    const api = {
      migrationCommit: vi
        .fn()
        .mockRejectedValueOnce(new Error('Broken file'))
        .mockImplementation(async (plan: MigrationPlan) => makeReport({ source: plan.source })),
    };
    const plans = [brunoPlan('a'), brunoPlan('b')];
    const results = await commitPlans(api, plans);
    expect(api.migrationCommit).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual({ ok: false, plan: plans[0], error: 'Broken file' });
    expect(results[1].ok).toBe(true);
  });

  it('never throws, even if the bridge throws at once', async () => {
    const api = {
      migrationCommit: vi.fn(() => {
        throw new Error('Not implemented');
      }),
    };
    const results = await commitPlans(api, [makePlan()]);
    expect(results).toEqual([{ ok: false, plan: expect.anything(), error: 'Not implemented' }]);
  });

  it('turns a missing report into a failure instead of a broken screen', async () => {
    const results = await commitPlans({ migrationCommit: vi.fn().mockResolvedValue(NOTHING) }, [makePlan()]);
    expect(results[0]).toMatchObject({ ok: false, error: 'The migration did not return a report.' });
  });

  it('fills in report lists that are missing', async () => {
    const broken = { source: makeSource(), startedAt: 'a', finishedAt: 'b' } as unknown as MigrationReport;
    const [result] = await commitPlans({ migrationCommit: vi.fn().mockResolvedValue(broken) }, [makePlan()]);
    expect(result.ok && result.report.imported).toEqual({});
    expect(result.ok && result.report.entries).toEqual([]);
  });

  it('reports progress before each plan and when it is all done', async () => {
    const progress: ImportProgress[] = [];
    const api = { migrationCommit: vi.fn().mockResolvedValue(makeReport()) };
    await commitPlans(api, [brunoPlan('a'), brunoPlan('b')], update => progress.push(update));
    expect(progress).toEqual([
      { done: 0, total: 2, current: 'a' },
      { done: 1, total: 2, current: 'b' },
      { done: 2, total: 2, current: '' },
    ]);
  });

  it('does nothing for no plans', async () => {
    const api = { migrationCommit: vi.fn() };
    await expect(commitPlans(api, [])).resolves.toEqual([]);
    expect(api.migrationCommit).not.toHaveBeenCalled();
  });
});

describe('pluginNameProblem()', () => {
  it('accepts a normal plugin package', () => {
    expect(pluginNameProblem('insomnia-plugin-faker')).toBeNull();
  });

  it('accepts a scoped plugin package', () => {
    expect(pluginNameProblem('@acme/insomnia-plugin-faker')).toBeNull();
  });

  it('rejects names that are not plugin packages or that could do harm', () => {
    for (const name of [
      'lodash',
      '../insomnia-plugin-x',
      'insomnia-plugin-a;rm -rf',
      'insomnia-plugin-',
      '@acme',
      '',
    ]) {
      expect(pluginNameProblem(name), name).toEqual(expect.any(String));
    }
  });
});

describe('installMigratedPlugin()', () => {
  const makeDeps = () => ({
    install: vi.fn().mockResolvedValue(NOTHING),
    reload: vi.fn().mockResolvedValue(NOTHING),
  });

  it('installs the package, then reloads the plugins', async () => {
    const deps = makeDeps();
    await expect(installMigratedPlugin('insomnia-plugin-faker', deps)).resolves.toEqual({ ok: true });
    expect(deps.install).toHaveBeenCalledWith('insomnia-plugin-faker', false);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.install.mock.invocationCallOrder[0]).toBeLessThan(deps.reload.mock.invocationCallOrder[0]);
  });

  it('allows scoped names for a scoped package only', async () => {
    const deps = makeDeps();
    await installMigratedPlugin('@acme/insomnia-plugin-faker', deps);
    expect(deps.install).toHaveBeenCalledWith('@acme/insomnia-plugin-faker', true);
  });

  it('does not download anything for a name that fails the check', async () => {
    const deps = makeDeps();
    const result = await installMigratedPlugin('lodash', deps);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('returns the error when the install fails, and does not reload', async () => {
    const deps = makeDeps();
    deps.install.mockRejectedValue(new Error('Network is down'));
    await expect(installMigratedPlugin('insomnia-plugin-faker', deps)).resolves.toEqual({
      ok: false,
      error: 'Network is down',
    });
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('still counts as installed when only the reload fails', async () => {
    const deps = makeDeps();
    deps.reload.mockRejectedValue(new Error('Plugins window is busy'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(installMigratedPlugin('insomnia-plugin-faker', deps)).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
