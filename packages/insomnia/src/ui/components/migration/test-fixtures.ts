import type { DetectedSource, MigrationPlan, MigrationReport, PlanItem, ReportEntry } from '~/main/migration/types';

// What a bridge call returns when something goes wrong. Named so tests can pass it on purpose.
export const NOTHING = undefined;

// Made up for these tests. Nothing here is copied from a real install.
export const makeSource = (overrides: Partial<DetectedSource> = {}): DetectedSource => ({
  id: 'insomnia:/home/me/.config/Insomnia',
  kind: 'insomnia',
  path: '/home/me/.config/Insomnia',
  counts: { projects: 1, collections: 2, requests: 10, environments: 1 },
  running: false,
  ...overrides,
});

export const makeItem = (type: string, name = type, doc: Record<string, unknown> = {}): PlanItem => ({
  type,
  name,
  doc,
});

export const makePlan = (overrides: Partial<MigrationPlan> = {}): MigrationPlan => ({
  source: makeSource(),
  items: [],
  issues: [],
  plugins: [],
  ...overrides,
});

export const makeEntry = (overrides: Partial<ReportEntry> = {}): ReportEntry => ({
  reason: 'not-supported',
  type: 'Request',
  name: 'Get users',
  ...overrides,
});

export const makeReport = (overrides: Partial<MigrationReport> = {}): MigrationReport => ({
  source: makeSource(),
  startedAt: '2026-11-05T10:00:00.000Z',
  finishedAt: '2026-11-05T10:00:03.000Z',
  imported: {},
  entries: [],
  ...overrides,
});
