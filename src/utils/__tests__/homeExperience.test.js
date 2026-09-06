import { describe, expect, it } from 'vitest';
import {
  clearLegacyHomeQuery,
  HOME_EXPERIENCE,
  resolveHomeExperience,
} from '../homeExperience.js';

describe('home experience preference', () => {
  it('uses the latest home by default and for invalid stored values', () => {
    expect(resolveHomeExperience()).toBe(HOME_EXPERIENCE.LATEST);
    expect(resolveHomeExperience({ storedValue: 'unknown' })).toBe(HOME_EXPERIENCE.LATEST);
  });

  it('keeps an explicit classic-home preference', () => {
    expect(resolveHomeExperience({ storedValue: HOME_EXPERIENCE.CLASSIC }))
      .toBe(HOME_EXPERIENCE.CLASSIC);
  });

  it('lets legacy unified-preview links open the latest home', () => {
    expect(resolveHomeExperience({
      storedValue: HOME_EXPERIENCE.CLASSIC,
      search: '?home-demo=unified',
    })).toBe(HOME_EXPERIENCE.LATEST);
  });

  it('removes preview-only parameters while preserving unrelated query state', () => {
    expect(clearLegacyHomeQuery('?home-demo=unified&panel=guide&notice-id=7&from=share'))
      .toBe('from=share');
  });
});
