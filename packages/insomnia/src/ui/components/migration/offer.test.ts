import { describe, expect, it, vi } from 'vitest';

import { findOffer, shouldCheckForOffer } from './offer';
import { makeSource } from './test-fixtures';

describe('shouldCheckForOffer()', () => {
  it('looks on a normal first launch', () => {
    expect(shouldCheckForOffer({ hasSeenOffer: false, skipOnboarding: undefined })).toBe(true);
    expect(shouldCheckForOffer({ hasSeenOffer: false, skipOnboarding: '' })).toBe(true);
  });

  it('never looks again once the offer was answered', () => {
    expect(shouldCheckForOffer({ hasSeenOffer: true, skipOnboarding: undefined })).toBe(false);
  });

  it('keeps the skip path: INSOMNIA_SKIP_ONBOARDING turns the offer off', () => {
    expect(shouldCheckForOffer({ hasSeenOffer: false, skipOnboarding: 'true' })).toBe(false);
    expect(shouldCheckForOffer({ hasSeenOffer: false, skipOnboarding: '1' })).toBe(false);
  });

  it('treats any non-empty value as a skip, as the old onboarding did', () => {
    // The smoke tests pass an empty string, not "false", to turn onboarding on.
    expect(shouldCheckForOffer({ hasSeenOffer: false, skipOnboarding: 'false' })).toBe(false);
  });
});

describe('findOffer()', () => {
  it('offers the installs that have something to move', async () => {
    const full = makeSource();
    const empty = makeSource({
      kind: 'insomnium',
      id: 'insomnium:/x',
      path: '/x',
      counts: { projects: 1, collections: 0, requests: 0, environments: 0 },
    });
    const api = { migrationDetect: vi.fn().mockResolvedValue([empty, full]) };
    await expect(findOffer(api)).resolves.toEqual([full]);
  });

  it('looks once', async () => {
    const api = { migrationDetect: vi.fn().mockResolvedValue([makeSource()]) };
    await findOffer(api);
    expect(api.migrationDetect).toHaveBeenCalledTimes(1);
  });

  it('offers nothing when nothing is found', async () => {
    await expect(findOffer({ migrationDetect: vi.fn().mockResolvedValue([]) })).resolves.toBeNull();
  });

  it('offers nothing when every install is empty', async () => {
    const empty = makeSource({ counts: { projects: 0, collections: 0, requests: 0, environments: 0 } });
    await expect(findOffer({ migrationDetect: vi.fn().mockResolvedValue([empty]) })).resolves.toBeNull();
  });

  it('stays quiet when the look fails, since nobody asked for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = { migrationDetect: vi.fn().mockRejectedValue(new Error('Not implemented')) };
    await expect(findOffer(api)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
