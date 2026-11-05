import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useRevalidator } from 'react-router';

import type { DetectedSource, MigrationPlan } from '~/main/migration/types';

import {
  commitPlans,
  type CommitResult,
  detectInstalls,
  errorMessage,
  pickBrunoFolder,
  planBrunoFolder,
  planSource,
} from './flow';
import { canImport, createInitialState, flowReducer } from './flow-state';

// Plain async functions, not a router action: an action blocks navigation for as long as it runs.
export function useMigrationFlow(initialSources?: DetectedSource[]) {
  const [state, dispatch] = useReducer(flowReducer, initialSources, createInitialState);
  const { revalidate } = useRevalidator();
  const isReading = useRef(false);
  const isImporting = useRef(false);

  const detect = useCallback(async () => {
    dispatch({ type: 'detect-start' });
    try {
      dispatch({ type: 'detect-done', sources: await detectInstalls(window.main) });
    } catch (error) {
      dispatch({ type: 'detect-failed', error: errorMessage(error, 'Could not look for installs.') });
    }
  }, []);

  const hasLooked = useRef(initialSources !== undefined);
  useEffect(() => {
    if (!hasLooked.current) {
      hasLooked.current = true;
      detect();
    }
  }, [detect]);

  const read = useCallback(async (key: string, load: () => Promise<MigrationPlan[]>, emptyMessage: string) => {
    if (isReading.current) {
      return;
    }
    isReading.current = true;
    dispatch({ type: 'read-start', key });
    try {
      const plans = await load();
      if (plans.length === 0) {
        dispatch({ type: 'read-failed', error: emptyMessage });
      } else {
        dispatch({ type: 'read-done', plans });
      }
    } catch (error) {
      dispatch({ type: 'read-failed', error: errorMessage(error, 'Could not read that.') });
    } finally {
      isReading.current = false;
    }
  }, []);

  const reviewSource = useCallback(
    (source: DetectedSource) =>
      read(source.id, () => planSource(window.main, source), 'Nothing to copy was found there.'),
    [read],
  );

  const chooseBrunoFolder = useCallback(async () => {
    if (isReading.current) {
      return;
    }
    try {
      const folder = await pickBrunoFolder(window.dialog);
      if (folder) {
        await read(
          `folder:${folder}`,
          () => planBrunoFolder(window.main, folder),
          'No Bruno collections were found in that folder.',
        );
      }
    } catch (error) {
      dispatch({ type: 'read-failed', error: errorMessage(error, 'Could not open the folder picker.') });
    }
  }, [read]);

  const startImport = useCallback(async () => {
    if (isImporting.current || !canImport(state)) {
      return;
    }
    isImporting.current = true;
    dispatch({ type: 'import-start' });
    let results: CommitResult[];
    try {
      results = await commitPlans(window.main, state.plans, progress =>
        dispatch({ type: 'import-progress', progress }),
      );
    } catch (error) {
      // commitPlans reports each failure itself, so getting here is a bug. The window still must not stay locked.
      results = state.plans.map(plan => ({ ok: false, plan, error: errorMessage(error, 'The import failed.') }));
    }
    dispatch({ type: 'import-done', results });
    isImporting.current = false;
    // Some of it may have been written even when a plan failed, so always refresh.
    revalidate();
  }, [revalidate, state]);

  return {
    state,
    detect,
    reviewSource,
    chooseBrunoFolder,
    startImport,
    back: useCallback(() => dispatch({ type: 'back' }), []),
    restart: useCallback(() => dispatch({ type: 'restart' }), []),
  };
}
