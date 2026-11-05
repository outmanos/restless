export type SourceKind = 'insomnia' | 'insomnium' | 'bruno';

export interface DetectedSource {
  // Stable: kind plus path
  id: string;
  kind: SourceKind;
  path: string;
  counts: { projects: number; collections: number; requests: number; environments: number };
  // A lock or recent write suggests the app is open
  running: boolean;
}

export interface PlanItem {
  // Model type
  type: string;
  name: string;
  // Plain document, not yet through initModel
  doc: Record<string, unknown>;
}

export type ReportReason =
  | 'already-imported'
  | 'secret-not-readable'
  | 'cloud-only'
  | 'git-project'
  | 'file-missing'
  | 'unknown-model'
  | 'not-supported'
  | 'script-partly-translated'
  | 'parse-error';

export interface ReportEntry {
  reason: ReportReason;
  type: string;
  name: string;
  // Never a secret value
  detail?: string;
}

export interface MigrationPlan {
  source: DetectedSource;
  // Parents before children
  items: PlanItem[];
  // Known before writing
  issues: ReportEntry[];
  // Package names found, for the plugin step
  plugins: string[];
}

export interface MigrationReport {
  source: DetectedSource;
  startedAt: string;
  finishedAt: string;
  // By model type
  imported: Record<string, number>;
  // plan.issues plus commit results
  entries: ReportEntry[];
}
