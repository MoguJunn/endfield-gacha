import { describe, expect, it } from 'vitest';
import { AuthChainError } from '../../../utils/endfieldAuthChain.js';
import { normalizeImportError } from '../useOfficialImportController.js';

const t = (key, options = {}) => `${key}:${options.message || ''}`;

describe('official import failure classification', () => {
  it.each(['import-full', 'import-confirm'])('preserves write failures at %s without calling them authentication failures', (step) => {
    const message = '正式写入导入记录失败：canceling statement due to statement timeout';
    expect(normalizeImportError(new AuthChainError(message, step), t)).toBe(message);
  });

  it('still identifies credential and session failures', () => {
    expect(normalizeImportError(new AuthChainError('token invalid', 'grant'), t))
      .toBe('import.error.authFailed:token invalid');
    expect(normalizeImportError(new AuthChainError('expired', 'import-status', { code: 'AUTH_SESSION_INVALID' }), t))
      .toBe('import.error.authFailed:expired');
  });

  it.each([
    new AuthChainError('missing access token', 'import-full'),
    new AuthChainError('登录已失效', 'auth', { code: 'missing_access_token' }),
  ])('shows a readable reauthentication message for missing credentials', (error) => {
    expect(normalizeImportError(error, t)).toBe('import.error.sessionExpired:');
  });
});
