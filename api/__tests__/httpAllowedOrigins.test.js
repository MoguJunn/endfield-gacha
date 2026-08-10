import { describe, expect, it } from 'vitest';

import { isAllowedOrigin } from '../_lib/http.js';

describe('API allowed origins', () => {
  it('allows the public version calendar deployment', () => {
    expect(isAllowedOrigin('https://ef-cal.mogujun.icu')).toBe(true);
    expect(isAllowedOrigin('https://ef-cal.mogujun.icu/')).toBe(true);
    expect(isAllowedOrigin('https://endfield-version-calendar.vercel.app')).toBe(true);
    expect(isAllowedOrigin('https://endfield-version-calendar.vercel.app/')).toBe(true);
  });

  it('allows the registered domain alias', () => {
    expect(isAllowedOrigin('https://ef.nepst.cn')).toBe(true);
    expect(isAllowedOrigin('https://ef.nepst.cn/')).toBe(true);
  });

  it('continues to reject unknown external origins', () => {
    expect(isAllowedOrigin('https://untrusted-calendar.example')).toBe(false);
  });
});
