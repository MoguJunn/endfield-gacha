import { describe, expect, it } from 'vitest';

import { isAllowedOrigin } from '../_lib/http.js';

describe('API allowed origins', () => {
  it('allows the public version calendar deployment', () => {
    expect(isAllowedOrigin('https://endfield-version-calendar.vercel.app')).toBe(true);
    expect(isAllowedOrigin('https://endfield-version-calendar.vercel.app/')).toBe(true);
  });

  it('continues to reject unknown external origins', () => {
    expect(isAllowedOrigin('https://untrusted-calendar.example')).toBe(false);
  });
});
