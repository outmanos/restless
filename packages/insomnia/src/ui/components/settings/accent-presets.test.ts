import Color from 'color';
import { describe, expect, it } from 'vitest';

import { ACCENT_PRESETS } from './accent-presets';

describe('accent presets', () => {
  it.each(ACCENT_PRESETS)('$name gets white text', ({ color }) => {
    expect(Color(color).isDark()).toBe(true);
  });
});
