import { ipcMainHandle } from '../ipc/electron';
import { planBruno } from './bruno/plan';
import { commitPlan } from './commit';
import { detectPostman, detectSources } from './detect';
import { planInsomnia } from './insomnia/plan';
import type { DetectedSource, MigrationPlan, MigrationReport } from './types';

export interface MigrationBridgeAPI {
  migrationDetect: () => Promise<DetectedSource[]>;
  // Postman cannot be copied from, so this only says whether it is installed
  migrationDetectPostman: () => Promise<{ path: string } | null>;
  migrationPlanInsomnia: (source: DetectedSource) => Promise<MigrationPlan>;
  migrationPlanBruno: (folder: string) => Promise<MigrationPlan[]>;
  migrationCommit: (plan: MigrationPlan) => Promise<MigrationReport>;
}

export function registerMigrationHandlers() {
  ipcMainHandle('migrationDetect', () => detectSources());
  ipcMainHandle('migrationDetectPostman', () => detectPostman());
  ipcMainHandle('migrationPlanInsomnia', (_, source: DetectedSource) => planInsomnia(source));
  ipcMainHandle('migrationPlanBruno', (_, folder: string) => planBruno(folder));
  ipcMainHandle('migrationCommit', (_, plan: MigrationPlan) => commitPlan(plan));
}
