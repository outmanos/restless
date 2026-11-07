import { describe, expect, it } from 'vitest';

import { searchSettings,SETTINGS_INDEX } from './settings-index';
import { isSettingsTabKey } from './settings-tabs';

describe('settings index', () => {
  it('only points at tabs that exist, once per setting', () => {
    expect(SETTINGS_INDEX.every(entry => isSettingsTabKey(entry.tab))).toBe(true);
    const keys = SETTINGS_INDEX.map(entry => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('searchSettings', () => {
  it('finds a setting by part of its label', () => {
    expect(searchSettings('font')[0].tab).toBe('appearance');
    expect(searchSettings('proxy').map(entry => entry.key)).toContain('httpProxy');
  });

  it('finds a setting by something people call it', () => {
    expect(searchSettings('vim').map(entry => entry.key)).toContain('editorKeyMap');
    expect(searchSettings('beta').map(entry => entry.key)).toEqual(['updateChannel']);
  });

  it('needs every word to match', () => {
    expect(searchSettings('interface font').map(entry => entry.key)).toEqual(['fontInterface', 'fontSize']);
    expect(searchSettings('interface zzzz')).toEqual([]);
  });

  it('puts label matches before keyword matches', () => {
    const keys = searchSettings('update').map(entry => entry.key);
    expect(keys[0]).toBe('updateAutomatically');
  });

  it('returns nothing for an empty search', () => {
    expect(searchSettings('   ')).toEqual([]);
  });
});
