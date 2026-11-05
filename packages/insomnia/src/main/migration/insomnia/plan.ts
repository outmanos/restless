import type { DetectedSource, MigrationPlan } from '../types';

export async function planInsomnia(_source: DetectedSource): Promise<MigrationPlan> {
  throw new Error('Not implemented');
}
