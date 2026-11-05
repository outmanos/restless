import type { MigrationPlan, MigrationReport } from './types';

export async function commitPlan(_plan: MigrationPlan): Promise<MigrationReport> {
  throw new Error('Not implemented');
}
