import { useEffect } from 'react';

import { getSkipOnboarding } from '~/common/constants';
import { showModal } from '~/ui/components/modals';
import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { MigrationModal } from './migration-modal';
import { findOffer, shouldCheckForOffer } from './offer';

// Leaves the first seconds of startup alone, and lets the window settle before anything pops up over it.
const CHECK_DELAY_MS = 2000;

// One offer per window, even if the layout that calls this mounts again.
let hasOffered = false;

// First launch: if another app is found on this computer, offer to copy it over. Once only.
// It looks at local files and nothing else. Skipped with INSOMNIA_SKIP_ONBOARDING, like the old onboarding.
export const useMigrationOffer = () => {
  const settings = useRootLoaderData()?.settings;
  // Without settings loaded there is nothing to decide on, so act as if the offer was seen.
  const hasSeenOffer = !settings || Boolean(settings.hasSeenMigrationOffer);

  useEffect(() => {
    if (hasOffered || !shouldCheckForOffer({ hasSeenOffer, skipOnboarding: getSkipOnboarding() })) {
      return;
    }
    let isCancelled = false;
    const timer = setTimeout(async () => {
      const sources = await findOffer(window.main);
      if (isCancelled || hasOffered || !sources) {
        return;
      }
      hasOffered = true;
      try {
        showModal(MigrationModal, { offer: true, sources });
      } catch (error) {
        console.warn('[migration] could not show the offer', error);
      }
    }, CHECK_DELAY_MS);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [hasSeenOffer]);
};
