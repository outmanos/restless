import { describe, expect, it } from 'vitest';

import { takenNames, uniqueName } from './project-names';

describe('project names', () => {
  it('keeps a free name', () => {
    expect(uniqueName('API', new Set(), 'Bruno')).toBe('API');
  });

  it('adds the product, then a number, on a clash', () => {
    expect(uniqueName('API', new Set(['api']), 'Bruno')).toBe('API (Bruno)');
    expect(uniqueName('API', new Set(['api', 'api (bruno)']), 'Bruno')).toBe('API (Bruno 2)');
  });

  it('ignores the project itself, so a re-run keeps its name', () => {
    const existing = [{ _id: 'proj_1', name: 'API' }];
    expect(takenNames(existing, new Set(), 'proj_1').has('api')).toBe(false);
    expect(takenNames(existing, new Set(), 'proj_2').has('api')).toBe(true);
  });

  it('counts names claimed in the same run', () => {
    expect(takenNames([], new Set(['API']), 'proj_1').has('api')).toBe(true);
  });
});
