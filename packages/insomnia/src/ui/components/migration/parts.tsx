import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import type { ReactNode } from 'react';
import { Button as AriaButton, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { twMerge } from 'tailwind-merge';

import { Icon } from '~/basic-components';

import { typeLabel } from './labels';
import { type CountSummary, type EntryGroup, formatNumber, keyEntries, type OriginEntry } from './summary';

// The scrolling part of a step. The footer stays put below it.
export const Body = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">{children}</div>
);

export const Footer = ({ children }: { children: ReactNode }) => (
  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
);

export const Section = ({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) => (
  <section className="flex flex-col gap-2" data-testid={testId}>
    <h3 className="text-sm font-semibold">{title}</h3>
    {children}
  </section>
);

export const Spinner = () => <Icon icon="spinner" className="animate-spin" aria-hidden />;

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const NOTICE_STYLES: Record<NoticeTone, { box: string; icon: IconProp }> = {
  info: { box: 'border-(--hl-md) bg-(--hl-xs)', icon: 'circle-info' },
  warning: { box: 'border-(--color-warning) bg-(--color-warning)/10', icon: 'triangle-exclamation' },
  error: { box: 'border-(--color-danger) bg-(--color-danger)/10', icon: 'circle-exclamation' },
  success: { box: 'border-(--color-success) bg-(--color-success)/10', icon: 'circle-check' },
};

export const Notice = ({
  tone,
  title,
  children,
  action,
  testId,
}: {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) => (
  <div
    role={tone === 'error' ? 'alert' : undefined}
    className={twMerge('flex gap-3 rounded-sm border border-solid p-3 text-sm', NOTICE_STYLES[tone].box)}
    data-testid={testId}
  >
    <Icon icon={NOTICE_STYLES[tone].icon} className="mt-0.5 shrink-0" aria-hidden />
    <div className="flex min-w-0 flex-col items-start gap-1">
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className="break-words">{children}</div>}
      {action}
    </div>
  </div>
);

export const CountList = ({ summary }: { summary: CountSummary }) => (
  <div className="flex flex-col gap-1">
    {summary.rows.length > 0 ? (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-1 text-sm">
        {summary.rows.map(row => (
          <li key={row.type} className="flex items-baseline gap-2">
            <span className="font-semibold tabular-nums">{formatNumber(row.count)}</span> <span>{row.label}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-(--hl)">Nothing to copy.</p>
    )}
    {summary.supporting > 0 && (
      <p className="text-xs text-(--hl)">
        Plus {formatNumber(summary.supporting)} view settings, such as which folders are open.
      </p>
    )}
  </div>
);

// Long lists would make the window slow. The copied report always has every entry.
const MAX_VISIBLE_ENTRIES = 100;

const EntryGroupView = ({ group }: { group: EntryGroup<OriginEntry> }) => {
  const visible = keyEntries(group.entries.slice(0, MAX_VISIBLE_ENTRIES));
  const hidden = group.entries.length - visible.length;
  // Short lists open by themselves. "Already in restless" can be thousands of lines, so it never does.
  const startsOpen = group.entries.length <= 5 && group.reason !== 'already-imported';

  return (
    <Disclosure
      defaultExpanded={startsOpen}
      className="group rounded-md border border-solid border-(--hl-md)"
      data-testid={`migration-group-${group.reason}`}
    >
      <Heading className="m-0 text-base">
        <AriaButton
          slot="trigger"
          className="flex w-full cursor-pointer items-start gap-2 rounded-md p-3 text-left text-sm outline-none data-focus-visible:ring-2 data-focus-visible:ring-(--hl-lg) data-hovered:bg-(--hl-xs)"
        >
          <Icon
            icon="chevron-right"
            className="mt-1 shrink-0 text-xs transition-transform group-data-expanded:rotate-90"
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{group.title}</span>
            {group.hint && <span className="text-xs text-(--hl)">{group.hint}</span>}
          </span>
          <span className="rounded-full bg-(--hl-sm) px-2 text-xs tabular-nums">
            {formatNumber(group.entries.length)}
          </span>
        </AriaButton>
      </Heading>
      <DisclosurePanel>
        <div className="flex flex-col gap-2 border-t border-solid border-(--hl-md) p-3">
          <ul className="flex flex-col gap-1.5 text-sm">
            {visible.map(({ key, entry }) => (
              <li key={key} className="flex flex-col">
                <span className="break-words">
                  <span className="font-medium">{entry.name || '(no name)'}</span>{' '}
                  <span className="text-(--hl)">{typeLabel(entry.type)}</span>
                  {entry.origin && <span className="text-(--hl)">, in {entry.origin}</span>}
                </span>
                {entry.detail && <span className="text-xs break-words text-(--hl)">{entry.detail}</span>}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="text-xs text-(--hl)">and {formatNumber(hidden)} more. Copy the report to see them all.</p>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
};

export const EntryGroups = ({ groups }: { groups: EntryGroup<OriginEntry>[] }) => (
  <div className="flex flex-col gap-2">
    {groups.map(group => (
      <EntryGroupView key={group.reason} group={group} />
    ))}
  </div>
);
