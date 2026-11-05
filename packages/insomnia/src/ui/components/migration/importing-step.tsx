import { Icon, Progress } from '~/basic-components';

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
            <Progress percent={Math.round((done / total) * 100)} className="w-full" />
          </>
        )}
        <p className="text-sm text-(--hl)">Keep this window open until it finishes.</p>
      </div>
    </Body>
  );
};
