import { describe, expect, it } from 'vitest';

import type { CommitResult } from './flow';
import { canImport, createInitialState, type FlowAction, flowReducer, type FlowState, isBusy } from './flow-state';
import { makeItem, makePlan, makeReport, makeSource } from './test-fixtures';

const run = (state: FlowState, ...actions: FlowAction[]) => actions.reduce(flowReducer, state);

const importable = makePlan({ items: [makeItem('Request')] });
const results: CommitResult[] = [{ ok: true, plan: importable, report: makeReport() }];

// A state sitting on the review step, ready to import.
const reviewing = () =>
  run(createInitialState([makeSource()]), { type: 'read-start', key: 'a' }, { type: 'read-done', plans: [importable] });

describe('createInitialState()', () => {
  it('starts by looking for installs', () => {
    const state = createInitialState();
    expect(state.step).toBe('detect');
    expect(state.detect).toEqual({ status: 'loading', sources: [], error: null });
  });

  it('skips the look when the installs are already known', () => {
    const sources = [makeSource()];
    expect(createInitialState(sources).detect).toEqual({ status: 'ready', sources, error: null });
  });
});

describe('detecting installs', () => {
  it('goes from loading to ready with the installs found', () => {
    const sources = [makeSource(), makeSource({ kind: 'insomnium', id: 'insomnium:/x', path: '/x' })];
    const state = run(createInitialState(), { type: 'detect-done', sources });
    expect(state.detect).toEqual({ status: 'ready', sources, error: null });
  });

  it('shows the error and can look again', () => {
    const failed = run(createInitialState(), { type: 'detect-failed', error: 'Not implemented' });
    expect(failed.detect).toEqual({ status: 'error', sources: [], error: 'Not implemented' });
    const again = run(failed, { type: 'detect-start' });
    expect(again.detect).toEqual({ status: 'loading', sources: [], error: null });
  });
});

describe('reading a source for review', () => {
  it('marks which source is being read', () => {
    const state = run(createInitialState([makeSource()]), { type: 'read-start', key: 'insomnia:/x' });
    expect(state.reading).toBe('insomnia:/x');
    expect(state.readError).toBeNull();
  });

  it('ignores a second read while one is running', () => {
    const state = run(
      createInitialState([makeSource()]),
      { type: 'read-start', key: 'first' },
      { type: 'read-start', key: 'second' },
    );
    expect(state.reading).toBe('first');
  });

  it('moves to review with the plans, however many there are', () => {
    const plans = [importable, makePlan(), makePlan()];
    const state = run(createInitialState([]), { type: 'read-start', key: 'k' }, { type: 'read-done', plans });
    expect(state.step).toBe('review');
    expect(state.plans).toEqual(plans);
    expect(state.reading).toBeNull();
  });

  it('ignores a result that nobody asked for', () => {
    const state = createInitialState([]);
    expect(flowReducer(state, { type: 'read-done', plans: [importable] })).toBe(state);
  });

  it('stays on the first step and shows the error when reading fails', () => {
    const state = run(
      createInitialState([makeSource()]),
      { type: 'read-start', key: 'k' },
      { type: 'read-failed', error: 'Cannot read the folder' },
    );
    expect(state.step).toBe('detect');
    expect(state.reading).toBeNull();
    expect(state.readError).toBe('Cannot read the folder');
  });

  it('can show an error that happened before any read started', () => {
    const state = run(createInitialState([]), { type: 'read-failed', error: 'No folder picker' });
    expect(state.readError).toBe('No folder picker');
  });

  it('clears an old error when the next read starts', () => {
    const state = run(createInitialState([]), { type: 'read-failed', error: 'Old' }, { type: 'read-start', key: 'k' });
    expect(state.readError).toBeNull();
  });

  it('does not start reading once past the first step', () => {
    const state = reviewing();
    expect(flowReducer(state, { type: 'read-start', key: 'again' })).toBe(state);
  });
});

describe('going back', () => {
  it('returns to the first step and forgets the plans', () => {
    const state = run(reviewing(), { type: 'back' });
    expect(state.step).toBe('detect');
    expect(state.plans).toEqual([]);
  });

  it('keeps the installs that were found', () => {
    const sources = [makeSource()];
    const state = run(
      createInitialState(sources),
      { type: 'read-start', key: 'k' },
      { type: 'read-done', plans: [importable] },
      { type: 'back' },
    );
    expect(state.detect.sources).toEqual(sources);
  });

  it('does nothing outside review', () => {
    const state = createInitialState([]);
    expect(flowReducer(state, { type: 'back' })).toBe(state);
  });
});

describe('importing', () => {
  it('starts only from review, and locks the window', () => {
    const state = run(reviewing(), { type: 'import-start' });
    expect(state.step).toBe('importing');
    expect(state.progress).toEqual({ done: 0, total: 1, current: '' });
    expect(isBusy(state)).toBe(true);
  });

  it('does not start with nothing to import', () => {
    const empty = run(
      createInitialState([]),
      { type: 'read-start', key: 'k' },
      { type: 'read-done', plans: [makePlan()] },
    );
    expect(canImport(empty)).toBe(false);
    expect(flowReducer(empty, { type: 'import-start' })).toBe(empty);
  });

  it('does not start from the first step', () => {
    const state = createInitialState([makeSource()]);
    expect(flowReducer(state, { type: 'import-start' })).toBe(state);
  });

  it('cannot be started twice', () => {
    const state = run(reviewing(), { type: 'import-start' });
    expect(flowReducer(state, { type: 'import-start' })).toBe(state);
  });

  it('follows the progress', () => {
    const progress = { done: 1, total: 2, current: 'Shop API' };
    const state = run(reviewing(), { type: 'import-start' }, { type: 'import-progress', progress });
    expect(state.progress).toEqual(progress);
  });

  it('ignores progress that arrives late', () => {
    const state = reviewing();
    expect(flowReducer(state, { type: 'import-progress', progress: { done: 1, total: 1, current: '' } })).toBe(state);
  });

  it('ends on the report with the results, and unlocks the window', () => {
    const state = run(reviewing(), { type: 'import-start' }, { type: 'import-done', results });
    expect(state.step).toBe('report');
    expect(state.results).toEqual(results);
    expect(state.progress).toBeNull();
    expect(isBusy(state)).toBe(false);
  });

  it('shows a report even when every plan failed', () => {
    const failed: CommitResult[] = [{ ok: false, plan: importable, error: 'Broken' }];
    const state = run(reviewing(), { type: 'import-start' }, { type: 'import-done', results: failed });
    expect(state.step).toBe('report');
    expect(state.results).toEqual(failed);
  });

  it('ignores a result when no import is running', () => {
    const state = reviewing();
    expect(flowReducer(state, { type: 'import-done', results })).toBe(state);
  });
});

describe('starting over', () => {
  it('goes back to the first step and clears the last result', () => {
    const done = run(reviewing(), { type: 'import-start' }, { type: 'import-done', results });
    const state = run(done, { type: 'restart' });
    expect(state.step).toBe('detect');
    expect(state.plans).toEqual([]);
    expect(state.results).toEqual([]);
    expect(state.detect.status).toBe('ready');
  });

  it('only works from the report', () => {
    const state = reviewing();
    expect(flowReducer(state, { type: 'restart' })).toBe(state);
  });
});

describe('isBusy()', () => {
  it('is only true while importing', () => {
    expect(isBusy(createInitialState())).toBe(false);
    expect(isBusy(reviewing())).toBe(false);
    expect(isBusy(run(reviewing(), { type: 'import-start' }))).toBe(true);
  });
});

describe('canImport()', () => {
  it('needs at least one plan with something in it', () => {
    expect(canImport({ plans: [] })).toBe(false);
    expect(canImport({ plans: [makePlan()] })).toBe(false);
    expect(canImport({ plans: [makePlan(), importable] })).toBe(true);
  });
});
