import { describe, expect, it, vi } from 'vitest';

import { commandQuery, isCommandInput, type PaletteCommand, searchCommands, settingsForQuery } from './command-mode';

const make = (id: string, title: string, keywords?: string[]): PaletteCommand => ({
  id,
  title,
  keywords,
  run: vi.fn(),
});

const commands = [
  make('prefs', 'Open Preferences', ['settings', 'options']),
  make('shortcuts', 'Open Keyboard Shortcuts', ['hotkeys']),
  make('update', 'Check for updates', ['version']),
  make('about', 'About restless', ['version']),
];

describe('command input', () => {
  it('knows when the palette is in command mode', () => {
    expect(isCommandInput('>')).toBe(true);
    expect(isCommandInput('  > pref')).toBe(true);
    expect(isCommandInput('pref')).toBe(false);
  });

  it('reads what follows the >', () => {
    expect(commandQuery('>')).toBe('');
    expect(commandQuery('> open pref')).toBe('open pref');
  });
});

describe('searchCommands', () => {
  it('lists everything for an empty query', () => {
    expect(searchCommands('', commands)).toEqual(commands);
  });

  it('matches the start of words in the title', () => {
    expect(searchCommands('pref', commands).map(command => command.id)).toEqual(['prefs']);
    expect(searchCommands('open k', commands).map(command => command.id)).toEqual(['shortcuts']);
  });

  it('matches keywords after the title', () => {
    expect(searchCommands('settings', commands).map(command => command.id)).toEqual(['prefs']);
    expect(searchCommands('version', commands).map(command => command.id)).toEqual(['update', 'about']);
  });

  it('needs every word to match', () => {
    expect(searchCommands('open zzz', commands)).toEqual([]);
  });
});

describe('settingsForQuery', () => {
  it('shows no settings until something is typed', () => {
    expect(settingsForQuery('')).toEqual([]);
    expect(settingsForQuery('proxy').length).toBeGreaterThan(0);
  });
});
