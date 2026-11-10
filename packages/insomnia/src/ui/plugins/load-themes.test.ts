import { beforeEach, describe, expect, it, vi } from 'vitest';

const getThemes = vi.hoisted(() => vi.fn());
vi.mock('./renderer-bridge', () => ({ plugins: { getThemes } }));

const { builtInThemeEntries, loadThemes, pickTheme } = await import('./misc');

beforeEach(() => {
  getThemes.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('loadThemes', () => {
  it('uses the themes the plugins bridge returns', async () => {
    const entries = builtInThemeEntries().slice(0, 2);
    getThemes.mockResolvedValue(entries);
    expect(await loadThemes()).toBe(entries);
  });

  it('falls back to the built-in themes when loading fails, so colors are still set', async () => {
    getThemes.mockRejectedValue(new Error('plugins are not ready'));
    const themes = await loadThemes();
    expect(themes.map(t => t.theme.name)).toContain('default');
  });
});

describe('pickTheme', () => {
  it('finds the theme by name', () => {
    expect(pickTheme(builtInThemeEntries(), 'studio-light')?.theme.name).toBe('studio-light');
  });

  it('uses the default theme for a name that is not there', () => {
    expect(pickTheme(builtInThemeEntries(), 'removed-plugin-theme')?.theme.name).toBe('default');
  });

  it('still finds the default theme in the built-in ones when the loaded list is empty', () => {
    expect(pickTheme([], 'default')?.theme.name).toBe('default');
    expect(pickTheme([], 'something-else')?.theme.name).toBe('default');
  });
});
