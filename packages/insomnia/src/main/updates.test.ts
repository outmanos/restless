import { UpdateCheckInterval } from 'insomnia-data/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { allowsAutomaticUpdates, getCheckIntervalMs, getUpdateSupport, isCheckDue } from './updates';

const electronApp = vi.hoisted(() => ({ isPackaged: true }));

vi.mock('electron', () => ({ app: electronApp, BrowserWindow: {}, dialog: {} }));
vi.mock('electron-updater', () => ({ autoUpdater: {} }));
vi.mock('./backup', () => ({ backup: vi.fn() }));
vi.mock('./ipc/electron', () => ({ ipcMainOn: vi.fn() }));

describe('allowsAutomaticUpdates', () => {
  it('is true when the installer checkbox was ticked', () => {
    expect(allowsAutomaticUpdates('{"installer": "nsis", "allowAutomaticUpdates": true}')).toBe(true);
  });

  it('is false when the checkbox was left off', () => {
    expect(allowsAutomaticUpdates('{"installer": "nsis"}')).toBe(false);
  });

  it('is false without a readable installer file', () => {
    expect(allowsAutomaticUpdates('')).toBe(false);
    expect(allowsAutomaticUpdates('not json')).toBe(false);
  });
});

describe('isCheckDue', () => {
  const hour = 60 * 60 * 1000;
  const on = { updateAutomatically: true, updateCheckInterval: UpdateCheckInterval.daily };

  it('never fires with automatic updates off', () => {
    expect(isCheckDue({ ...on, updateAutomatically: false }, 0, 100 * 24 * hour)).toBe(false);
  });

  it('waits for the chosen interval', () => {
    expect(isCheckDue(on, 0, 23 * hour)).toBe(false);
    expect(isCheckDue(on, 0, 24 * hour)).toBe(true);
    expect(isCheckDue({ ...on, updateCheckInterval: UpdateCheckInterval.sixHours }, 0, 6 * hour)).toBe(true);
    expect(isCheckDue({ ...on, updateCheckInterval: UpdateCheckInterval.weekly }, 0, 24 * hour)).toBe(false);
    expect(isCheckDue({ ...on, updateCheckInterval: UpdateCheckInterval.monthly }, 0, 29 * 24 * hour)).toBe(false);
    expect(isCheckDue({ ...on, updateCheckInterval: UpdateCheckInterval.monthly }, 0, 30 * 24 * hour)).toBe(true);
  });

  it('falls back to daily for an unknown interval', () => {
    expect(getCheckIntervalMs('hourly' as UpdateCheckInterval)).toBe(24 * hour);
  });
});

describe('getUpdateSupport', () => {
  const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true });
  const realPlatform = process.platform;

  afterEach(() => {
    setPlatform(realPlatform);
    electronApp.isPackaged = true;
    vi.unstubAllEnvs();
  });

  it('works on an AppImage', () => {
    setPlatform('linux');
    vi.stubEnv('APPIMAGE', '/home/me/Restless.AppImage');
    vi.stubEnv('INSOMNIA_ENV', 'production');
    expect(getUpdateSupport()).toEqual({ supported: true });
  });

  it('leaves other Linux builds to the package manager', () => {
    setPlatform('linux');
    vi.stubEnv('APPIMAGE', '');
    vi.stubEnv('INSOMNIA_ENV', 'production');
    expect(getUpdateSupport()).toEqual({ supported: false, reason: 'package-manager' });
  });

  it('skips unpackaged builds and the portable Windows build', () => {
    vi.stubEnv('INSOMNIA_ENV', 'production');
    electronApp.isPackaged = false;
    expect(getUpdateSupport()).toEqual({ supported: false, reason: 'development' });
    electronApp.isPackaged = true;
    setPlatform('win32');
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', 'C:\\portable');
    expect(getUpdateSupport()).toEqual({ supported: false, reason: 'portable' });
  });

  it('honors the opt-out variable', () => {
    vi.stubEnv('INSOMNIA_DISABLE_AUTOMATIC_UPDATES', '1');
    expect(getUpdateSupport()).toEqual({ supported: false, reason: 'disabled' });
  });
});
