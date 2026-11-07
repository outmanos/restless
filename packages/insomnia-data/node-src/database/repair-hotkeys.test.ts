import { keyboardKeys, newDefaultRegistry } from 'insomnia-data/common';
import { describe, expect, it, vi } from 'vitest';

vi.mock('insomnia-data', () => ({ database: {}, models: {} }));
vi.mock('../services/api-spec', () => ({}));
vi.mock('../services/project', () => ({}));
vi.mock('../services/settings', () => ({}));

const { repairHotKeyRegistry } = await import('./repair-database');

const oldPin = {
  macKeys: [{ shift: true, meta: true, keyCode: keyboardKeys.p.keyCode }],
  winLinuxKeys: [{ shift: true, ctrl: true, keyCode: keyboardKeys.p.keyCode }],
};

describe('repairHotKeyRegistry', () => {
  it('leaves a registry that has everything alone', () => {
    const defaults = newDefaultRegistry();
    expect(repairHotKeyRegistry(defaults, defaults).changed).toBe(false);
  });

  it('adds shortcuts that are missing', () => {
    const defaults = newDefaultRegistry();
    const { palette_commandMode: _removed, ...stored } = defaults;
    const { registry, changed } = repairHotKeyRegistry(stored, defaults);
    expect(changed).toBe(true);
    expect(registry.palette_commandMode).toEqual(defaults.palette_commandMode);
  });

  it('moves pinning off Ctrl+Shift+P when it is still the old default', () => {
    const defaults = newDefaultRegistry();
    const { registry, changed } = repairHotKeyRegistry({ ...defaults, request_togglePin: oldPin }, defaults);
    expect(changed).toBe(true);
    expect(registry.request_togglePin).toEqual(defaults.request_togglePin);
  });

  it('keeps a pin shortcut the person chose', () => {
    const defaults = newDefaultRegistry();
    const chosen = {
      macKeys: [{ meta: true, keyCode: keyboardKeys.k.keyCode }],
      winLinuxKeys: [{ ctrl: true, keyCode: keyboardKeys.k.keyCode }],
    };
    const { registry } = repairHotKeyRegistry({ ...defaults, request_togglePin: chosen }, defaults);
    expect(registry.request_togglePin).toEqual(chosen);
  });
});
