import type { DetectedSource } from '~/main/migration/types';

import { detectInstalls, type MigrationApi } from './flow';
import { hasContent } from './summary';

interface OfferGate {
  // Setting: the one-time offer was answered, or migration was opened another way
  hasSeenOffer: boolean;
  // INSOMNIA_SKIP_ONBOARDING. Any non-empty value skips, as the old onboarding did. Smoke tests set it.
  skipOnboarding: string | undefined;
}

// Whether to look for installs at all. When this is false nothing is read.
export const shouldCheckForOffer = ({ hasSeenOffer, skipOnboarding }: OfferGate): boolean =>
  !hasSeenOffer && !skipOnboarding;

// The installs worth offering, or null if there are none or the look failed.
// A failed look is only logged, since nobody asked for it and a popup at launch would be noise.
export async function findOffer(api: Pick<MigrationApi, 'migrationDetect'>): Promise<DetectedSource[] | null> {
  try {
    const sources = (await detectInstalls(api)).filter(hasContent);
    return sources.length > 0 ? sources : null;
  } catch (error) {
    console.warn('[migration] could not look for installs', error);
    return null;
  }
}
