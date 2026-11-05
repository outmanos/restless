import { useMemo } from 'react';

import { Button } from '~/basic-components';
import type { MigrationPlan } from '~/main/migration/types';

import { QUIET_SKIPS_NOTE } from './labels';
import { Body, CountList, EntryGroups, Footer, Section } from './parts';
import {
  countItemsByType,
  describeItems,
  formatCount,
  formatNumber,
  groupEntries,
  planTitle,
  summarizeCounts,
  withOrigin,
} from './summary';

export const ReviewStep = ({
  plans,
  canImport,
  onBack,
  onImport,
}: {
  plans: MigrationPlan[];
  canImport: boolean;
  onBack: () => void;
  onImport: () => void;
}) => {
  const isSeveral = plans.length > 1;
  const counts = useMemo(() => summarizeCounts(countItemsByType(plans.flatMap(plan => plan.items))), [plans]);
  const groups = useMemo(
    () => groupEntries(plans.flatMap(plan => withOrigin(plan.issues, isSeveral ? planTitle(plan) : undefined))),
    [plans, isSeveral],
  );
  const isFromInsomnia = plans.some(plan => plan.source.kind === 'insomnia' || plan.source.kind === 'insomnium');

  return (
    <>
      <Body>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold" data-testid="migration-review-title">
            {isSeveral ? `${formatCount(plans.length, 'collection')} found` : planTitle(plans[0])}
          </span>
          <span className="truncate text-xs text-(--hl)" title={plans[0].source.path}>
            {plans[0].source.path}
          </span>
        </div>
        <p className="text-sm text-(--hl)">
          Nothing is written until you click Import. The original data is never changed.
        </p>

        <Section title="Will be added" testId="migration-review-counts">
          <CountList summary={counts} />
        </Section>

        {isSeveral && (
          <Section title="Collections" testId="migration-review-plans">
            <ul className="flex flex-col gap-1 text-sm">
              {plans.map(plan => (
                <li key={plan.source.id} className="flex flex-col">
                  <span className="font-medium break-words">{planTitle(plan)}</span>
                  <span className="text-xs text-(--hl)">
                    {describeItems(plan.items)}
                    {plan.issues.length > 0 && `, ${formatNumber(plan.issues.length)} to check`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Skipped or needs a check" testId="migration-review-issues">
          {groups.length > 0 ? (
            <EntryGroups groups={groups} />
          ) : (
            <p className="text-sm text-(--hl)">Nothing is left out.</p>
          )}
        </Section>

        {isFromInsomnia && <p className="text-xs text-(--hl)">{QUIET_SKIPS_NOTE}</p>}
      </Body>
      <Footer>
        <Button onPress={onBack} data-testid="migration-back">
          Back
        </Button>
        <Button primary isDisabled={!canImport} onPress={onImport} data-testid="migration-import">
          Import
        </Button>
      </Footer>
    </>
  );
};
