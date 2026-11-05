import { useEffect, useMemo, useState } from 'react';

import { Button, Icon } from '~/basic-components';

import { type CommitFailure, type CommitResult, hasReport } from './flow';
import { QUIET_SKIPS_NOTE } from './labels';
import { Body, CountList, EntryGroups, Footer, Notice, Section } from './parts';
import { PluginList } from './plugin-list';
import { formatReportText, reportHeadline } from './report-text';
import { collectPlugins, groupEntries, planTitle, sumCounts, summarizeCounts, withOrigin } from './summary';

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyState, string> = {
  idle: 'Copy report',
  copied: 'Copied',
  failed: 'Could not copy',
};

export const ReportStep = ({
  results,
  onRetry,
  onRestart,
  onClose,
}: {
  results: CommitResult[];
  onRetry: () => void;
  onRestart: () => void;
  onClose: () => void;
}) => {
  const isSeveral = results.length > 1;
  const headline = useMemo(() => reportHeadline(results), [results]);
  const added = useMemo(
    () => summarizeCounts(sumCounts(results.map(result => (result.ok ? result.report.imported : undefined)))),
    [results],
  );
  const groups = useMemo(
    () =>
      groupEntries(
        results.flatMap(result =>
          result.ok ? withOrigin(result.report.entries, isSeveral ? planTitle(result.plan) : undefined) : [],
        ),
      ),
    [results, isSeveral],
  );
  const failures = results.filter((result): result is CommitFailure => !result.ok);
  // When every plan stopped with an error there is no report, so only the errors are shown.
  const isReported = hasReport(results);
  // Plugins are for a finished migration. A plan that stopped with an error has not moved anything yet.
  const plugins = useMemo(
    () => collectPlugins(results.filter(result => result.ok).map(result => result.plan)),
    [results],
  );
  const isFromInsomnia = results.some(
    result => result.plan.source.kind === 'insomnia' || result.plan.source.kind === 'insomnium',
  );

  const [copyState, setCopyState] = useState<CopyState>('idle');
  useEffect(() => {
    if (copyState === 'idle') {
      return;
    }
    const timer = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copyReport = async () => {
    try {
      await window.clipboard.writeText(formatReportText(results));
      setCopyState('copied');
    } catch (error) {
      console.warn('[migration] could not copy the report', error);
      setCopyState('failed');
    }
  };

  return (
    <>
      <Body>
        <Notice tone={headline.tone} title={headline.title} testId="migration-headline">
          {headline.detail}
        </Notice>

        {failures.length > 0 && (
          <Section title="Stopped with an error" testId="migration-report-failures">
            <ul className="flex flex-col gap-2 text-sm">
              {failures.map(failure => (
                <li key={failure.plan.source.id} className="flex flex-col">
                  <span className="font-medium break-words">{planTitle(failure.plan)}</span>
                  <span className="text-xs break-words text-(--color-danger)">{failure.error}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {isReported && (
          <>
            <Section title="Added" testId="migration-report-counts">
              <CountList summary={added} empty="Nothing was added." />
            </Section>

            <Section title="Skipped or needs a check" testId="migration-report-issues">
              {groups.length > 0 ? (
                <EntryGroups groups={groups} />
              ) : (
                <p className="text-sm text-(--hl)">Nothing was left out.</p>
              )}
            </Section>

            {isFromInsomnia && <p className="text-xs text-(--hl)">{QUIET_SKIPS_NOTE}</p>}
            <p className="text-xs text-(--hl)">
              restless also saves a copy of this report in its data folder, under migrations.
            </p>

            {plugins.length > 0 && <PluginList names={plugins} />}
          </>
        )}
      </Body>
      <Footer>
        <Button
          icon={<Icon icon={copyState === 'copied' ? 'check' : 'copy'} aria-hidden />}
          onPress={copyReport}
          data-testid="migration-copy-report"
        >
          {COPY_LABELS[copyState]}
        </Button>
        <Button onPress={onRestart} data-testid="migration-restart">
          Migrate more
        </Button>
        <Button primary={failures.length === 0} onPress={onClose} data-testid="migration-done">
          Done
        </Button>
        {failures.length > 0 && (
          <Button primary onPress={onRetry} data-testid="migration-retry">
            Try again
          </Button>
        )}
      </Footer>
    </>
  );
};
