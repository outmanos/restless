import type { DetectedSource, MigrationPlan, PlanItem, ReportEntry } from '~/main/migration/types';

import { isSupportingType, REASON_ORDER, reasonInfo, sourceLabel, typeLabel, typePosition } from './labels';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export const formatNumber = (value: number): string => NUMBER_FORMAT.format(value);

export const formatCount = (count: number, singular: string, plural = `${singular}s`): string =>
  `${formatNumber(count)} ${count === 1 ? singular : plural}`;

const toCount = (value: unknown): number => {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) && count > 0 ? count : 0;
};

// "2 projects, 5 collections, 120 requests", skipping anything that is zero.
export const describeCounts = (counts: Partial<DetectedSource['counts']> | undefined): string => {
  const parts: string[] = [];
  const add = (value: unknown, singular: string) => {
    const count = toCount(value);
    if (count > 0) {
      parts.push(formatCount(count, singular));
    }
  };
  add(counts?.projects, 'project');
  add(counts?.collections, 'collection');
  add(counts?.requests, 'request');
  add(counts?.environments, 'environment');
  return parts.length > 0 ? parts.join(', ') : 'Nothing to copy';
};

// Something worth offering to move. An install with no collections and no requests is just an empty app.
export const hasContent = (source: Pick<DetectedSource, 'counts'>): boolean =>
  toCount(source.counts?.collections) > 0 || toCount(source.counts?.requests) > 0;

export interface CountRow {
  type: string;
  count: number;
  // "request" or "requests", already matched to the count
  label: string;
}

export interface CountSummary {
  rows: CountRow[];
  // Counts of view-state records, shown as one line instead of one row each
  supporting: number;
  total: number;
}

const compareRows = (a: CountRow, b: CountRow) => {
  const byPosition = typePosition(a.type) - typePosition(b.type);
  return byPosition === 0 ? a.type.localeCompare(b.type) : byPosition;
};

// Takes counts by model type. A Map is accepted so a hostile type name can never hit the prototype.
export function summarizeCounts(
  byType: ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined,
): CountSummary {
  const entries = byType instanceof Map ? [...byType.entries()] : Object.entries(byType ?? {});
  const rows: CountRow[] = [];
  let supporting = 0;
  let total = 0;
  for (const [type, value] of entries) {
    const count = toCount(value);
    if (count === 0) {
      continue;
    }
    total += count;
    if (isSupportingType(type)) {
      supporting += count;
    } else {
      rows.push({ type, count, label: typeLabel(type, count) });
    }
  }
  rows.sort(compareRows);
  return { rows, supporting, total };
}

export function countItemsByType(items: readonly Pick<PlanItem, 'type'>[] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    const type = String(item.type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

// "12 requests, 3 folders, 2 environments": the first few kinds of item, for a one line summary.
export function describeItems(items: readonly Pick<PlanItem, 'type'>[] | undefined, limit = 3): string {
  const { rows } = summarizeCounts(countItemsByType(items));
  if (rows.length === 0) {
    return 'Nothing to copy';
  }
  // Projects and collections are the containers, so the content kinds are more telling
  const content = rows.filter(row => row.type !== 'Project' && row.type !== 'Workspace');
  return (content.length > 0 ? content : rows)
    .slice(0, limit)
    .map(row => `${formatNumber(row.count)} ${row.label}`)
    .join(', ');
}

// Adds up counts by model type, for several plans or reports at once.
export function sumCounts(all: readonly (Readonly<Record<string, number>> | undefined)[]): Map<string, number> {
  const sum = new Map<string, number>();
  for (const counts of all) {
    for (const [type, value] of Object.entries(counts ?? {})) {
      sum.set(type, (sum.get(type) ?? 0) + toCount(value));
    }
  }
  return sum;
}

export interface EntryGroup<T extends ReportEntry = ReportEntry> {
  // A ReportReason, or an unknown one from a newer backend
  reason: string;
  title: string;
  hint: string;
  entries: T[];
}

// Groups entries by reason in a fixed order. Input order is kept inside each group,
// and a reason the UI does not know still gets its own group at the end.
export function groupEntries<T extends ReportEntry>(entries: readonly T[] | undefined): EntryGroup<T>[] {
  const byReason = new Map<string, T[]>();
  for (const entry of entries ?? []) {
    const reason = String(entry.reason);
    const list = byReason.get(reason);
    if (list) {
      list.push(entry);
    } else {
      byReason.set(reason, [entry]);
    }
  }
  const known: string[] = REASON_ORDER.filter(reason => byReason.has(reason));
  const unknown = [...byReason.keys()].filter(reason => !known.includes(reason));
  return [...known, ...unknown].map(reason => ({
    reason,
    ...reasonInfo(reason),
    entries: byReason.get(reason) ?? [],
  }));
}

export interface KeyedEntry<T> {
  key: string;
  entry: T;
}

// Entries have no id and can repeat, so a key is built from the entry and how often it was seen before.
export function keyEntries<T extends ReportEntry>(entries: readonly T[]): KeyedEntry<T>[] {
  const seen = new Map<string, number>();
  return entries.map(entry => {
    const base = `${entry.type}|${entry.name}|${entry.detail ?? ''}`;
    const times = (seen.get(base) ?? 0) + 1;
    seen.set(base, times);
    return { key: `${base}|${times}`, entry };
  });
}

// An entry that remembers which collection it came from, for imports of several at once.
export interface OriginEntry extends ReportEntry {
  origin?: string;
}

const lastSegment = (path: string) => path.split(/[/\\]/).findLast(part => part.length > 0) ?? '';

// A readable name for one plan. Insomnia and Insomnium give one plan per install, named after the app.
// A Bruno plan is one collection: named after its collection, then its project, then its folder.
export function planTitle(plan: Pick<MigrationPlan, 'items' | 'source'>): string {
  const kind = plan.source?.kind ?? '';
  if (kind !== 'bruno') {
    return sourceLabel(kind) || 'Untitled';
  }
  const named = (type: string) => plan.items?.find(item => item.type === type && item.name)?.name;
  return named('Workspace') ?? named('Project') ?? (lastSegment(plan.source?.path ?? '') || 'Untitled');
}

export function withOrigin(entries: readonly ReportEntry[] | undefined, origin: string | undefined): OriginEntry[] {
  return (entries ?? []).map(entry => (origin ? { ...entry, origin } : { ...entry }));
}

// Plugin package names across plans, once each.
export function collectPlugins(plans: readonly Pick<MigrationPlan, 'plugins'>[]): string[] {
  const names = new Set<string>();
  for (const plan of plans) {
    for (const name of plan.plugins ?? []) {
      if (typeof name === 'string' && name.trim().length > 0) {
        names.add(name.trim());
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
