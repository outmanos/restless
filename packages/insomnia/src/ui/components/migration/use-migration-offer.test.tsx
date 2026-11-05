/**
 * @vitest-environment jsdom
 */
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSource } from './test-fixtures';

const mocks = vi.hoisted(() => ({
  showModal: vi.fn(),
  settings: undefined as { hasSeenMigrationOffer: boolean } | undefined,
}));

vi.mock('~/ui/components/modals', () => ({ showModal: mocks.showModal }));
vi.mock('~/ui/hooks/use-root-loader-data', () => ({
  useRootLoaderData: () => (mocks.settings ? { settings: mocks.settings } : undefined),
}));
// Only the identity of the modal matters here, not what it renders.
vi.mock('./migration-modal', () => ({ MigrationModal: { displayName: 'MigrationModal' } }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const migrationDetect = vi.fn();
let container: HTMLDivElement;
let root: Root;
const originalSkip = process.env.INSOMNIA_SKIP_ONBOARDING;

// A fresh copy of the hook module each time, because it remembers per window that it already offered.
const mount = async (options: { strict?: boolean } = {}) => {
  const { useMigrationOffer } = await import('./use-migration-offer');
  const Probe = () => {
    useMigrationOffer();
    return null;
  };
  act(() => {
    root.render(
      options.strict ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    );
  });
};

const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.INSOMNIA_SKIP_ONBOARDING;
  mocks.settings = { hasSeenMigrationOffer: false };
  migrationDetect.mockResolvedValue([makeSource()]);
  Object.assign(window, { main: { migrationDetect } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  if (originalSkip === undefined) {
    delete process.env.INSOMNIA_SKIP_ONBOARDING;
  } else {
    process.env.INSOMNIA_SKIP_ONBOARDING = originalSkip;
  }
});

describe('useMigrationOffer()', () => {
  it('looks a couple of seconds after the window is ready, then offers what it found', async () => {
    const sources = [makeSource()];
    migrationDetect.mockResolvedValue(sources);
    await mount();
    await pass(1500);
    expect(migrationDetect).not.toHaveBeenCalled();
    await pass(600);
    expect(migrationDetect).toHaveBeenCalledTimes(1);
    expect(mocks.showModal).toHaveBeenCalledTimes(1);
    expect(mocks.showModal).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'MigrationModal' }), {
      offer: true,
      sources,
    });
  });

  it('offers nothing when no install has anything to move', async () => {
    migrationDetect.mockResolvedValue([
      makeSource({ counts: { projects: 1, collections: 0, requests: 0, environments: 0 } }),
    ]);
    await mount();
    await pass(5000);
    expect(migrationDetect).toHaveBeenCalledTimes(1);
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('does not even look once the offer was seen', async () => {
    mocks.settings = { hasSeenMigrationOffer: true };
    await mount();
    await pass(10_000);
    expect(migrationDetect).not.toHaveBeenCalled();
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('keeps the skip path: with INSOMNIA_SKIP_ONBOARDING set it does not even look', async () => {
    process.env.INSOMNIA_SKIP_ONBOARDING = 'true';
    await mount();
    await pass(10_000);
    expect(migrationDetect).not.toHaveBeenCalled();
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('looks when the skip variable is set to an empty string, as the smoke tests do to turn onboarding on', async () => {
    process.env.INSOMNIA_SKIP_ONBOARDING = '';
    await mount();
    await pass(2100);
    expect(migrationDetect).toHaveBeenCalledTimes(1);
  });

  it('does nothing until the settings have loaded', async () => {
    mocks.settings = undefined;
    await mount();
    await pass(10_000);
    expect(migrationDetect).not.toHaveBeenCalled();
  });

  it('looks once even when React runs the effect twice', async () => {
    await mount({ strict: true });
    await pass(5000);
    expect(migrationDetect).toHaveBeenCalledTimes(1);
    expect(mocks.showModal).toHaveBeenCalledTimes(1);
  });

  it('offers once per window, even if it mounts again', async () => {
    await mount();
    await pass(2100);
    expect(mocks.showModal).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    await mount();
    await pass(5000);
    expect(mocks.showModal).toHaveBeenCalledTimes(1);
  });

  it('does not look if the window goes away first', async () => {
    await mount();
    await pass(1000);
    act(() => root.unmount());
    await pass(5000);
    expect(migrationDetect).not.toHaveBeenCalled();
  });

  it('stays quiet when the look fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    migrationDetect.mockRejectedValue(new Error('Not implemented'));
    await mount();
    await pass(5000);
    expect(mocks.showModal).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not let a missing modal host break the app', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.showModal.mockImplementation(() => {
      throw new Error('Modal MigrationModal not found');
    });
    await mount();
    await pass(5000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
