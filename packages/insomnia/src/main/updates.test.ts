import { describe, expect, it, vi } from 'vitest';

import { allowsAutomaticUpdates } from './updates';

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {} }));
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
