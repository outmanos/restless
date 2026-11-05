import { ProgressBar } from 'react-aria-components';

import { Icon } from '~/basic-components';

import type { ImportProgress } from './flow';
import { Body } from './parts';

// Shown while the import runs. The window cannot be closed here, because the import cannot be cancelled.
export const ImportingStep = ({ progress }: { progress: ImportProgress | null }) => {
  const total = progress?.total ?? 1;
  const done = progress?.done ?? 0;
  const isSeveral = total > 1;

  return (
    <Body>
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
        data-testid="migration-importing"
      >
        <Icon icon="spinner" className="animate-spin text-2xl" aria-hidden />
        <p className="font-semibold">Importing…</p>
        {isSeveral && (
          <>
            <p className="text-sm">
              {progress?.current
                ? `Collection ${Math.min(done + 1, total)} of ${total}: ${progress.current}`
                : `${done} of ${total} done`}
            </p>
            <ProgressBar aria-label="Import progress" value={done} maxValue={total} className="w-full">
              {({ percentage }) => (
                <div className="h-2 w-full overflow-hidden rounded-full bg-(--hl-sm)">
                  <div
                    className="h-full rounded-full bg-(--color-surprise) transition-[width] duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              )}
            </ProgressBar>
          </>
        )}
        <p className="text-sm text-(--hl)">Keep this window open until it finishes.</p>
      </div>
    </Body>
  );
};
