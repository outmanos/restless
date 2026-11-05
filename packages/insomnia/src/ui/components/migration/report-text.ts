import type { ReportEntry } from '~/main/migration/types';

import type { CommitResult } from './flow';
import { QUIET_SKIPS_NOTE, sourceLabel, typeLabel } from './labels';
import { formatCount, groupEntries, type OriginEntry, planTitle, summarizeCounts } from './summary';

export const entryLine = (entry: OriginEntry): string => {
  const name = entry.name || '(no name)';
  const detail = entry.detail ? `: ${entry.detail}` : '';
  const origin = entry.origin ? ` [${entry.origin}]` : '';
  return `- ${name} (${typeLabel(entry.type)})${detail}${origin}`;
};

function groupLines(entries: readonly ReportEntry[]): string[] {
  const lines: string[] = [];
  for (const [index, group] of groupEntries(entries).entries()) {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`${group.title} (${group.entries.length})`);
    if (group.hint) {
      lines.push(`  ${group.hint}`);
    }
    for (const entry of group.entries) {
      lines.push(`  ${entryLine(entry)}`);
    }
  }
  return lines;
}

function countLines(summary: ReturnType<typeof summarizeCounts>): string[] {
  const lines = summary.rows.map(row => `  ${row.count} ${row.label}`);
  if (summary.supporting > 0) {
    lines.push(`  ${summary.supporting} view settings`);
  }
  return lines.length > 0 ? lines : ['  Nothing was added'];
}

// When the import stops with an error there is no report, so nobody can say what was written.
// A retry is safe because everything that already went in is skipped, never overwritten.
export const FAILED_NOTE =
  'No report was written, so some items may already be in restless. Trying again is safe: items already there are skipped and nothing is overwritten.';

export interface Headline {
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail: string;
}

// Counts the things that were added, leaving out the small view-state records.
export const addedCount = (results: readonly CommitResult[]): number =>
  results.reduce(
    (sum, result) =>
      result.ok ? sum + summarizeCounts(result.report.imported).rows.reduce((rows, row) => rows + row.count, 0) : sum,
    0,
  );

// One line that says how it went, so the result is clear before any detail is read.
export function reportHeadline(results: readonly CommitResult[]): Headline {
  const failed = results.filter(result => !result.ok).length;
  const added = addedCount(results);

  if (results.length > 0 && failed === results.length) {
    return { tone: 'error', title: 'The import did not finish', detail: FAILED_NOTE };
  }
  if (failed > 0) {
    return {
      tone: 'warning',
      title: 'Import finished with errors',
      detail: `${failed} of ${results.length} stopped with an error and have no report. The rest went through. Trying again is safe: items already there are skipped.`,
    };
  }
  if (added === 0) {
    return { tone: 'warning', title: 'Nothing was added', detail: 'See below for why.' };
  }
  return { tone: 'success', title: 'Import finished', detail: `${formatCount(added, 'item')} added.` };
}

// The whole result as plain text, for pasting into a note or a bug report.
// It holds names, counts and reasons only. The documents themselves never go in.
export function formatReportText(results: readonly CommitResult[]): string {
  const lines: string[] = ['restless migration report'];
  const kinds = new Set<string>();

  for (const result of results) {
    const { source } = result.plan;
    kinds.add(source.kind);
    lines.push('', `${planTitle(result.plan)} (${sourceLabel(source.kind)}, ${source.path})`);

    if (!result.ok) {
      lines.push(`Failed: ${result.error}`, FAILED_NOTE);
      continue;
    }

    const { report } = result;
    lines.push(
      `Started: ${report.startedAt}`,
      `Finished: ${report.finishedAt}`,
      'Added:',
      ...countLines(summarizeCounts(report.imported)),
    );
    const issues = groupLines(report.entries);
    if (issues.length > 0) {
      lines.push('', 'Skipped or needs a check:', ...issues);
    }
  }

  if (kinds.has('insomnia') || kinds.has('insomnium')) {
    lines.push('', QUIET_SKIPS_NOTE);
  }
  return lines.join('\n');
}
