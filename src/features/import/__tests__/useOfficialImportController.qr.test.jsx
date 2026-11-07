import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useOfficialImportController } from '../useOfficialImportController.js';
import { importAllRecordsFullyOnBackend, requestOfficialQrSession } from '../../../utils/endfieldAuthChain.js';

vi.mock('../../../utils/endfieldAuthChain.js', async importOriginal => ({
  ...await importOriginal(),
  requestOfficialQrSession: vi.fn(async () => ({ cleared: true })),
  fetchImportQueueStatus: vi.fn(async () => ({})),
  importAllRecordsFullyOnBackend: vi.fn(),
}));
const t = key => key;
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ t }) }));
const account = { uid: 'binding', gameUid: 'game', nickName: '测试', channelMasterId: '2', serverId: '1' };
beforeEach(() => {
  vi.clearAllMocks();
  importAllRecordsFullyOnBackend.mockResolvedValue({ totalRecords: 1, savedRecords: 1 });
});

it('asks to confirm even a single QR account and submits a session reference with no Token', async () => {
  const onImportComplete = vi.fn();
  const { result } = renderHook(() => useOfficialImportController({ userId: 'owner', source: 'cn', onImportComplete }));
  act(() => result.current.handleQrAuthorized({ sessionId: 'opaque', accounts: [account] }));
  expect(result.current.status).toBe('account_selection');
  expect(importAllRecordsFullyOnBackend).not.toHaveBeenCalled();
  expect(result.current.tokenInput).toBe('');
  await act(async () => result.current.handleAccountSelect(result.current.availableAccounts[0]));
  expect(importAllRecordsFullyOnBackend).toHaveBeenCalledWith('', 0, 'owner', expect.any(Function), 'cn', { importMode: 'incremental', qrSessionId: 'opaque' });
  expect(onImportComplete).toHaveBeenCalledWith(expect.objectContaining({ success: true, userInfo: expect.objectContaining({ gameUid: 'game', serverId: 'bilibili' }) }));
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'opaque');
});

it('cleans an authorized QR session on reset, cancellation or owner change', async () => {
  const { result, rerender } = renderHook(({ userId }) => useOfficialImportController({ userId, source: 'cn' }), { initialProps: { userId: 'owner' } });
  act(() => result.current.handleQrAuthorized({ sessionId: 'one', accounts: [account] }));
  act(() => result.current.handleReset());
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'one');
  act(() => result.current.handleQrAuthorized({ sessionId: 'two', accounts: [account] }));
  await act(async () => result.current.handleCancel());
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'two');
  act(() => result.current.handleQrAuthorized({ sessionId: 'three', accounts: [account] }));
  rerender({ userId: 'other' });
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'three');
});

it('blocks a second account click and ignores an import receipt from a previous owner', async () => {
  let resolve;
  importAllRecordsFullyOnBackend.mockReturnValue(new Promise(done => { resolve = done; }));
  const onImportComplete = vi.fn();
  const { result, rerender } = renderHook(({ userId }) => useOfficialImportController({ userId, source: 'cn', onImportComplete }),
    { initialProps: { userId: 'owner' } });
  act(() => result.current.handleQrAuthorized({ sessionId: 'opaque', accounts: [account] }));
  let pending;
  act(() => { pending = result.current.handleAccountSelect(account); });
  await act(async () => result.current.handleAccountSelect(account));
  expect(importAllRecordsFullyOnBackend).toHaveBeenCalledTimes(1);
  rerender({ userId: 'other' });
  await act(async () => { resolve({ totalRecords: 1, savedRecords: 1 }); await pending; });
  expect(onImportComplete).not.toHaveBeenCalled();
});
