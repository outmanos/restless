// @vitest-environment jsdom
import { NewRequestCollection } from 'insomnia-data/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { pickCollection, readCollectionChoice, rememberCollectionChoice } from './new-request-collection';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const { lastUsed, first } = NewRequestCollection;

describe('pickCollection', () => {
  it('keeps the choice made in this session', () => {
    expect(pickCollection(items, 'c', 'b', lastUsed)).toBe('c');
    expect(pickCollection(items, 'c', 'b', first)).toBe('c');
  });

  it('uses the remembered collection when there is no current one', () => {
    expect(pickCollection(items, null, 'b', lastUsed)).toBe('b');
  });

  it('uses the first collection when the setting asks for it', () => {
    expect(pickCollection(items, null, 'b', first)).toBe('a');
  });

  it('falls back to the first when the remembered or current one is gone', () => {
    expect(pickCollection(items, 'gone', 'also-gone', lastUsed)).toBe('a');
    expect(pickCollection(items, null, null, lastUsed)).toBe('a');
  });

  it('picks nothing when there are no collections', () => {
    expect(pickCollection([], 'a', 'a', lastUsed)).toBeNull();
  });
});

describe('remembering the choice', () => {
  beforeEach(() => localStorage.clear());

  it('remembers one collection per project', () => {
    rememberCollectionChoice('proj_1', 'wrk_a');
    rememberCollectionChoice('proj_2', 'wrk_b');
    rememberCollectionChoice('proj_1', 'wrk_c');
    expect(readCollectionChoice('proj_1')).toBe('wrk_c');
    expect(readCollectionChoice('proj_2')).toBe('wrk_b');
    expect(readCollectionChoice('proj_3')).toBeNull();
  });

  it('survives broken stored data', () => {
    localStorage.setItem('new-request-collection', 'not json');
    expect(readCollectionChoice('proj_1')).toBeNull();
    expect(() => rememberCollectionChoice('proj_1', 'wrk_a')).not.toThrow();
  });
});
