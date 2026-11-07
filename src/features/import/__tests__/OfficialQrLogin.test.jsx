import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OfficialQrLogin from '../components/OfficialQrLogin.jsx';
import OfficialImportContent from '../components/OfficialImportContent.jsx';
import { requestOfficialQrSession } from '../../../utils/endfieldAuthChain.js';

vi.mock('../../../utils/endfieldAuthChain.js', () => ({ requestOfficialQrSession: vi.fn() }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ locale: 'zh-CN', t: key => key }) }));
beforeEach(() => {
  vi.useFakeTimers();
  requestOfficialQrSession.mockReset();
  requestOfficialQrSession.mockImplementation(async action => action === 'qr-start'
    ? { sessionId: 'opaque-session', scanUrl: 'https://example.com/login', expiresAt: Date.now() + 120000, pollIntervalMs: 2000 }
    : { status: 'waiting' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows a local QR code, waits for phone confirmation and transfers only the session and accounts', async () => {
  const onAuthorized = vi.fn();
  const view = render(<OfficialQrLogin onAuthorized={onAuthorized} />);
  expect(requestOfficialQrSession).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' })));
  expect(screen.getByTitle('官方登录二维码')).toBeInTheDocument();
  expect(onAuthorized).not.toHaveBeenCalled();
  requestOfficialQrSession.mockResolvedValueOnce({ status: 'authorized', accounts: [{ gameUid: 'uid', serverId: 'bilibili' }] });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(onAuthorized).toHaveBeenCalledWith({ sessionId: 'opaque-session', accounts: [{ gameUid: 'uid', serverId: 'bilibili' }] });
  view.unmount();
  expect(requestOfficialQrSession).not.toHaveBeenCalledWith('qr-close', 'opaque-session');
});

it('closes an unused QR session when leaving the dialog', async () => {
  const view = render(<OfficialQrLogin onAuthorized={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' })));
  view.unmount();
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'opaque-session');
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(requestOfficialQrSession).not.toHaveBeenCalledWith('qr-poll', 'opaque-session');
});

it('lets the header close action clear the QR session and return to the initial card', async () => {
  render(<OfficialQrLogin onAuthorized={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' })));
  fireEvent.click(screen.getByRole('button', { name: '关闭二维码' }));
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'opaque-session');
  expect(screen.getByRole('button', { name: '获取登录二维码' })).toBeEnabled();
  expect(screen.queryByTitle('官方登录二维码')).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(requestOfficialQrSession).not.toHaveBeenCalledWith('qr-poll', 'opaque-session');
});

it('closes a late-created session after unmount and never displays stale QR data', async () => {
  let resolve;
  requestOfficialQrSession.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<OfficialQrLogin onAuthorized={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' }));
  view.unmount();
  await act(async () => resolve({ sessionId: 'late', scanUrl: 'https://example.com' }));
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'late');
});

it('explains failures and lets the user get a new QR without copying a token', async () => {
  render(<OfficialQrLogin onAuthorized={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' })));
  requestOfficialQrSession.mockRejectedValueOnce(new Error('二维码已失效，请重新获取'));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByRole('alert')).toHaveTextContent('二维码已失效');
  expect(screen.getByRole('button', { name: '重新获取二维码' })).toBeEnabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('renders the account confirmation screen for a single scanned role', () => {
  const account = { uid: 'binding', gameUid: '123', nickName: '扫码角色', serverTag: 'B服' };
  const onSelectAccount = vi.fn();
  render(<OfficialImportContent usingQrLogin source="cn" status="account_selection" availableAccounts={[account]}
    onSelectAccount={onSelectAccount} />);
  expect(screen.getByText('确认本次导入账号')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /扫码角色/ }));
  expect(onSelectAccount).toHaveBeenCalledWith(account);
});

it('clears the QR session when switching methods and keeps manual input when switching back', async () => {
  const onStartImport = vi.fn();
  function LoginFixture() {
    const [token, setToken] = React.useState('');
    return <OfficialImportContent source="cn" status="idle" tokenInput={token} availableAccounts={[]}
      backendImportAvailable importMode="incremental" onQrAuthorized={vi.fn()} onStartImport={onStartImport}
      onTokenChange={event => setToken(event.target.value)} />;
  }
  render(<LoginFixture />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'import.official.start' })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '获取登录二维码' })));
  const qrTab = screen.getByRole('tab', { name: /import.official.qrLogin/ });
  fireEvent.keyDown(qrTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'import.official.tokenLogin' })).toHaveFocus();
  expect(requestOfficialQrSession).toHaveBeenCalledWith('qr-close', 'opaque-session');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AbCdEf123456789012345678' } });
  fireEvent.click(qrTab);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '获取登录二维码' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: 'import.official.tokenLogin' }));
  expect(screen.getByRole('textbox')).toHaveValue('AbCdEf123456789012345678');
  fireEvent.click(screen.getByRole('button', { name: 'import.official.start' }));
  expect(onStartImport).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(requestOfficialQrSession).not.toHaveBeenCalledWith('qr-poll', 'opaque-session');
});
