import { validatePluginName } from '~/common/utils/plugin-name';
import type { MigrationBridgeAPI } from '~/main/migration/ipc';
import type { DetectedSource, MigrationPlan, MigrationReport } from '~/main/migration/types';

import { planTitle } from './summary';

export type MigrationApi = MigrationBridgeAPI;

export interface CommitSuccess {
  ok: true;
  plan: MigrationPlan;
  report: MigrationReport;
}

export interface CommitFailure {
  ok: false;
  plan: MigrationPlan;
  error: string;
}

export type CommitResult = CommitSuccess | CommitFailure;

export interface ImportProgress {
  done: number;
  total: number;
  // Name of the plan being written, empty when nothing is
  current: string;
}

// The preload already strips Electron's "Error invoking remote method" prefix. This also covers errors that did not pass through it.
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim();
  return cleaned || fallback;
}

// Data crosses a process boundary here. A missing list must not turn into a crash while rendering.
function sanitizePlan(plan: MigrationPlan): MigrationPlan {
  if (!plan || typeof plan !== 'object') {
    throw new Error('The migration returned nothing to review.');
  }
  return {
    ...plan,
    items: Array.isArray(plan.items) ? plan.items : [],
    issues: Array.isArray(plan.issues) ? plan.issues : [],
    plugins: Array.isArray(plan.plugins) ? plan.plugins : [],
  };
}

function sanitizeReport(report: MigrationReport): MigrationReport {
  if (!report || typeof report !== 'object') {
    throw new Error('The migration did not return a report.');
  }
  return {
    ...report,
    imported: report.imported && typeof report.imported === 'object' ? report.imported : {},
    entries: Array.isArray(report.entries) ? report.entries : [],
  };
}

// Looks for installs on this computer. Reads local files only.
export async function detectInstalls(api: Pick<MigrationApi, 'migrationDetect'>): Promise<DetectedSource[]> {
  const sources = await api.migrationDetect();
  return Array.isArray(sources) ? sources : [];
}

export async function planBrunoFolder(
  api: Pick<MigrationApi, 'migrationPlanBruno'>,
  folder: string,
): Promise<MigrationPlan[]> {
  const plans = await api.migrationPlanBruno(folder);
  return (Array.isArray(plans) ? plans : []).map(sanitizePlan);
}

// Reads one source and returns what would move. Nothing is written.
export async function planSource(
  api: Pick<MigrationApi, 'migrationPlanInsomnia' | 'migrationPlanBruno'>,
  source: DetectedSource,
): Promise<MigrationPlan[]> {
  if (source.kind === 'bruno') {
    return planBrunoFolder(api, source.path);
  }
  return [sanitizePlan(await api.migrationPlanInsomnia(source))];
}

interface FolderDialog {
  showOpenDialog: (options: {
    title: string;
    buttonLabel: string;
    properties: 'openDirectory'[];
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

// Returns the chosen folder, or null if the user cancelled.
export async function pickBrunoFolder(dialog: FolderDialog): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose a Bruno folder',
    buttonLabel: 'Choose',
    properties: ['openDirectory'],
  });
  return canceled || !filePaths?.[0] ? null : filePaths[0];
}

// Writes the plans one after the other. A plan that fails is reported and the rest still run,
// because each Bruno collection stands alone. Never throws, so the caller always reaches a result screen.
export async function commitPlans(
  api: Pick<MigrationApi, 'migrationCommit'>,
  plans: readonly MigrationPlan[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<CommitResult[]> {
  const results: CommitResult[] = [];
  for (const [index, plan] of plans.entries()) {
    onProgress?.({ done: index, total: plans.length, current: planTitle(plan) });
    try {
      const report = sanitizeReport(await api.migrationCommit(plan));
      results.push({ ok: true, plan, report });
    } catch (error) {
      results.push({ ok: false, plan, error: errorMessage(error, 'The import failed.') });
    }
  }
  onProgress?.({ done: plans.length, total: plans.length, current: '' });
  return results;
}

// False when every plan stopped with an error. Then there is no report to show, only the errors.
export const hasReport = (results: readonly CommitResult[]): boolean => results.some(result => result.ok);

export const failedPlans = (results: readonly CommitResult[]): MigrationPlan[] =>
  results.filter(result => !result.ok).map(result => result.plan);

// Puts the results of a retry where the failures were. What already went through stays as it was.
// The retry ran the failed plans in order, so they line up one to one.
export function mergeRetried(previous: readonly CommitResult[], retried: readonly CommitResult[]): CommitResult[] {
  let next = 0;
  return previous.map(result => (result.ok ? result : (retried[next++] ?? result)));
}

export interface PluginInstallDeps {
  install: (name: string, allowScopedPackageNames: boolean) => Promise<void>;
  // Loads the new plugin into the running app
  reload: () => Promise<void>;
}

export type PluginInstallResult = { ok: true } | { ok: false; error: string };

// Returns a message when this package name cannot be installed from the migration screen.
export function pluginNameProblem(name: string): string | null {
  return validatePluginName(name, name.startsWith('@'));
}

// The same install the Plugins tab uses. It downloads from npm, so it only runs on a click.
export async function installMigratedPlugin(name: string, deps: PluginInstallDeps): Promise<PluginInstallResult> {
  const problem = pluginNameProblem(name);
  if (problem) {
    return { ok: false, error: problem };
  }
  try {
    await deps.install(name, name.startsWith('@'));
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'The install failed.') };
  }
  try {
    await deps.reload();
  } catch (error) {
    // The plugin is on disk, so it is not a failed install. Reload Plugins in the File menu picks it up.
    console.warn('[migration] plugin installed but reload failed', error);
  }
  return { ok: true };
}
