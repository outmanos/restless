import { forwardRef, type MutableRefObject, useCallback, useImperativeHandle, useRef, useState } from 'react';

import { Modal } from '~/basic-components';
import type { DetectedSource } from '~/main/migration/types';
import type { ModalProps } from '~/ui/components/base/modal';
import { useSettingsPatcher } from '~/ui/hooks/use-request';
import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { DetectStep } from './detect-step';
import { canImport, isBusy } from './flow-state';
import { ImportingStep } from './importing-step';
import { ReportStep } from './report-step';
import { ReviewStep } from './review-step';
import { useMigrationFlow } from './use-migration-flow';

export interface MigrationModalOptions {
  // Opened by the first-launch offer, so the first step reads as an offer and can be declined
  offer?: boolean;
  // Installs the offer already found, so the window does not look again
  sources?: DetectedSource[];
}

export interface MigrationModalHandle {
  show: (options?: MigrationModalOptions) => void;
  hide: () => void;
}

const MigrationDialog = ({
  options,
  busyRef,
  onClose,
}: {
  options: MigrationModalOptions;
  // Tells the shell when the window must not be closed
  busyRef: MutableRefObject<boolean>;
  onClose: () => void;
}) => {
  const flow = useMigrationFlow(options.sources);
  const { state } = flow;
  const busy = isBusy(state);
  busyRef.current = busy;

  return (
    <Modal
      isOpen
      centered
      title="Migrate to restless"
      closable={!busy}
      // A click outside must not throw away a plan that took a while to read. Escape and the X still close it.
      isDismissable={false}
      onClose={onClose}
      className="w-[min(44rem,calc(100vw-2rem))]"
    >
      <div
        className="flex max-h-[calc(var(--visual-viewport-height)-12rem)] min-h-0 flex-col gap-4"
        data-testid="migration-modal"
        data-step={state.step}
      >
        {state.step === 'detect' && (
          <DetectStep
            state={state}
            isOffer={Boolean(options.offer)}
            onReview={flow.reviewSource}
            onChooseBruno={flow.chooseBrunoFolder}
            onRetry={flow.detect}
            onClose={onClose}
          />
        )}
        {state.step === 'review' && (
          <ReviewStep plans={state.plans} canImport={canImport(state)} onBack={flow.back} onImport={flow.startImport} />
        )}
        {state.step === 'importing' && <ImportingStep progress={state.progress} />}
        {state.step === 'report' && <ReportStep results={state.results} onRestart={flow.restart} onClose={onClose} />}
      </div>
    </Modal>
  );
};

// Opened with showModal(MigrationModal): from File > Migrate from…, the import window and the first-launch offer.
export const MigrationModal = forwardRef<MigrationModalHandle, ModalProps>((_, ref) => {
  const [session, setSession] = useState<{ id: number; options: MigrationModalOptions } | null>(null);
  const nextId = useRef(0);
  const busyRef = useRef(false);
  const settings = useRootLoaderData()?.settings;
  const patchSettings = useSettingsPatcher();

  const close = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    // However it was opened, the first-launch offer has no reason to appear after this.
    if (settings && !settings.hasSeenMigrationOffer) {
      patchSettings({ hasSeenMigrationOffer: true });
    }
    setSession(null);
  }, [patchSettings, settings]);

  const latestClose = useRef(close);
  latestClose.current = close;

  useImperativeHandle(
    ref,
    () => ({
      show: options => {
        // Asking again while it is open, or while an import runs, keeps what is on screen.
        const id = ++nextId.current;
        setSession(current => current ?? { id, options: options ?? {} });
      },
      hide: () => latestClose.current(),
    }),
    [],
  );

  // A new key per opening gives each one a fresh flow, so nothing is left over from the last.
  return session ? (
    <MigrationDialog key={session.id} options={session.options} busyRef={busyRef} onClose={close} />
  ) : null;
});

MigrationModal.displayName = 'MigrationModal';
