import type { DetectedSource, MigrationPlan } from '~/main/migration/types';

import type { CommitResult, ImportProgress } from './flow';

export type Step = 'detect' | 'review' | 'importing' | 'report';

export interface FlowState {
  step: Step;
  detect: {
    status: 'loading' | 'ready' | 'error';
    sources: DetectedSource[];
    error: string | null;
  };
  // Id of the source, or the folder, being read for review. Null when nothing is being read.
  reading: string | null;
  readError: string | null;
  plans: MigrationPlan[];
  progress: ImportProgress | null;
  results: CommitResult[];
}

export type FlowAction =
  | { type: 'detect-start' }
  | { type: 'detect-done'; sources: DetectedSource[] }
  | { type: 'detect-failed'; error: string }
  | { type: 'read-start'; key: string }
  | { type: 'read-done'; plans: MigrationPlan[] }
  | { type: 'read-failed'; error: string }
  | { type: 'back' }
  | { type: 'import-start' }
  | { type: 'import-progress'; progress: ImportProgress }
  | { type: 'import-done'; results: CommitResult[] }
  | { type: 'restart' };

// Sources found before the modal opened (the first-launch offer) skip the second look.
export const createInitialState = (sources?: DetectedSource[]): FlowState => ({
  step: 'detect',
  detect: sources ? { status: 'ready', sources, error: null } : { status: 'loading', sources: [], error: null },
  reading: null,
  readError: null,
  plans: [],
  progress: null,
  results: [],
});

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'detect-start': {
      return { ...state, detect: { status: 'loading', sources: state.detect.sources, error: null } };
    }
    case 'detect-done': {
      return { ...state, detect: { status: 'ready', sources: action.sources, error: null } };
    }
    case 'detect-failed': {
      return { ...state, detect: { status: 'error', sources: [], error: action.error } };
    }
    case 'read-start': {
      if (state.step !== 'detect' || state.reading !== null) {
        return state;
      }
      return { ...state, reading: action.key, readError: null };
    }
    case 'read-done': {
      if (state.reading === null) {
        return state;
      }
      return { ...state, step: 'review', reading: null, readError: null, plans: action.plans };
    }
    case 'read-failed': {
      return { ...state, reading: null, readError: action.error };
    }
    case 'back': {
      if (state.step !== 'review') {
        return state;
      }
      return { ...state, step: 'detect', plans: [], readError: null };
    }
    case 'import-start': {
      if (state.step !== 'review' || !canImport(state)) {
        return state;
      }
      return {
        ...state,
        step: 'importing',
        progress: { done: 0, total: state.plans.length, current: '' },
      };
    }
    case 'import-progress': {
      if (state.step !== 'importing') {
        return state;
      }
      return { ...state, progress: action.progress };
    }
    case 'import-done': {
      if (state.step !== 'importing') {
        return state;
      }
      return { ...state, step: 'report', progress: null, results: action.results };
    }
    case 'restart': {
      if (state.step !== 'report') {
        return state;
      }
      return { ...state, step: 'detect', plans: [], results: [], readError: null, progress: null };
    }
    default: {
      return state;
    }
  }
}

// The window must not be closed while the import runs, since it cannot be cancelled.
export const isBusy = (state: FlowState): boolean => state.step === 'importing';

export const canImport = (state: Pick<FlowState, 'plans'>): boolean => state.plans.some(plan => plan.items.length > 0);
