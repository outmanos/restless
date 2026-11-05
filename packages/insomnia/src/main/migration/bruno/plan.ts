import type { MigrationPlan } from '../types';

// `folder` is a collection, or a parent of many
export async function planBruno(_folder: string): Promise<MigrationPlan[]> {
  throw new Error('Not implemented');
}
