import { Button, Icon } from '~/basic-components';
import type { DetectedSource } from '~/main/migration/types';

import type { FlowState } from './flow-state';
import { sourceLabel } from './labels';
import { Body, Footer, Notice, Spinner } from './parts';
import { describeCounts } from './summary';

const SourceCard = ({
  source,
  isBusy,
  isReading,
  onReview,
}: {
  source: DetectedSource;
  // Another source is being read, so every button waits
  isBusy: boolean;
  isReading: boolean;
  onReview: (source: DetectedSource) => void;
}) => {
  const label = sourceLabel(source.kind);
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-solid border-(--hl-md) p-3"
      data-testid={`migration-source-${source.kind}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{label}</span>
          <span className="truncate text-xs text-(--hl)" title={source.path}>
            {source.path}
          </span>
          <span className="text-sm">{describeCounts(source.counts)}</span>
        </div>
        <Button
          primary
          size="sm"
          isDisabled={isBusy}
          aria-label={`Review ${label}`}
          data-testid={`migration-review-${source.kind}`}
          onPress={() => onReview(source)}
        >
          {isReading ? (
            <>
              <Spinner /> Reading…
            </>
          ) : (
            'Review'
          )}
        </Button>
      </div>
      {source.running && (
        <Notice tone="warning" testId="migration-running-warning">
          {label} seems to be open. Close it first so the copy is complete.
        </Notice>
      )}
    </li>
  );
};

export const DetectStep = ({
  state,
  isOffer,
  onReview,
  onChooseBruno,
  onRetry,
  onClose,
}: {
  state: FlowState;
  isOffer: boolean;
  onReview: (source: DetectedSource) => void;
  onChooseBruno: () => void;
  onRetry: () => void;
  onClose: () => void;
}) => {
  const { detect, reading, readError } = state;
  const isBusy = reading !== null;

  return (
    <>
      <Body>
        <div className="flex flex-col gap-1 text-sm text-(--hl)">
          <p>
            {isOffer
              ? 'restless found another app on this computer. You can copy your projects, requests and environments over now. The original data is never changed.'
              : 'Copy your projects, requests and environments from another app. The original data is never changed.'}
          </p>
          {isOffer && <p>Later, find this under File &gt; Migrate from…</p>}
        </div>

        {detect.status === 'loading' && (
          <p className="flex items-center gap-2 text-sm" role="status" data-testid="migration-looking">
            <Spinner /> Looking for installs…
          </p>
        )}
        {detect.status === 'error' && (
          <Notice
            tone="error"
            title="Could not look for installs"
            testId="migration-detect-error"
            action={
              <Button size="sm" onPress={onRetry}>
                Try again
              </Button>
            }
          >
            {detect.error}
          </Notice>
        )}
        {detect.status === 'ready' && detect.sources.length === 0 && (
          <p className="text-sm text-(--hl)" data-testid="migration-none-found">
            No Insomnia or Insomnium installs were found on this computer.
          </p>
        )}
        {detect.status === 'ready' && detect.sources.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Installs found" data-testid="migration-sources">
            {detect.sources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                isBusy={isBusy}
                isReading={reading === source.id}
                onReview={onReview}
              />
            ))}
          </ul>
        )}

        <section
          className="flex items-start justify-between gap-3 rounded-md border border-dashed border-(--hl-md) p-3"
          data-testid="migration-bruno"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">Bruno</span>
            <span className="text-sm text-(--hl)">Pick a collection folder, or a folder that holds several.</span>
          </div>
          <Button
            size="sm"
            isDisabled={isBusy}
            icon={<Icon icon="folder-open" aria-hidden />}
            data-testid="migration-choose-bruno"
            onPress={onChooseBruno}
          >
            Choose folder…
          </Button>
        </section>

        {readError && (
          <Notice tone="error" title="Could not review that" testId="migration-read-error">
            {readError}
          </Notice>
        )}
      </Body>
      <Footer>
        <Button onPress={onClose} data-testid="migration-close">
          {isOffer ? 'Not now' : 'Close'}
        </Button>
      </Footer>
    </>
  );
};
