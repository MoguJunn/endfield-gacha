import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, QrCode, RefreshCw, X } from 'lucide-react';
import { requestOfficialQrSession } from '../../../utils/endfieldAuthChain.js';
import { useI18n } from '../../../i18n/index.js';
import sklandIcon from '../../../assets/import/skland.jpg';
import endfieldIcon from '../../../assets/import/endfield.jpg';
import cloudEndfieldIcon from '../../../assets/import/cloud-endfield.png';
import './officialQrLogin.css';

const SCAN_APPS = [
  { name: '森空岛', nameEn: 'SKLand', icon: sklandIcon },
  { name: '明日方舟：终末地', nameEn: 'Endfield', icon: endfieldIcon },
  { name: '云·终末地', nameEn: 'Cloud Endfield', icon: cloudEndfieldIcon },
];

export default function OfficialQrLogin({ onAuthorized, disabled = false }) {
  const { locale } = useI18n();
  const en = locale === 'en-US';
  const [state, setState] = useState({ phase: 'idle' });
  const generation = useRef(0);
  const session = useRef(null);
  const timer = useRef(null);
  const busy = useRef(false);
  const close = id => { if (id) void requestOfficialQrSession('qr-close', id).catch(() => {}); };
  useEffect(() => () => {
    generation.current += 1;
    clearTimeout(timer.current);
    close(session.current);
    session.current = null;
  }, []);

  function reset() {
    generation.current += 1;
    clearTimeout(timer.current);
    close(session.current);
    session.current = null;
    busy.current = false;
    setState({ phase: 'idle' });
  }

  async function start() {
    if (busy.current || disabled) return;
    busy.current = true;
    const current = ++generation.current;
    clearTimeout(timer.current);
    close(session.current);
    session.current = null;
    setState({ phase: 'creating' });
    try {
      const created = await requestOfficialQrSession('qr-start');
      if (generation.current !== current) { close(created.sessionId); return; }
      session.current = created.sessionId;
      setState({ phase: 'waiting', ...created });
      const poll = async () => {
        if (generation.current !== current) return;
        try {
          if (Date.now() >= created.expiresAt) throw new Error(en ? 'QR code expired. Please try again.' : '二维码已过期，请重新获取');
          const result = await requestOfficialQrSession('qr-poll', created.sessionId);
          if (generation.current !== current) return;
          if (result.status === 'authorized') {
            onAuthorized({ sessionId: created.sessionId, accounts: result.accounts });
            session.current = null; // The controller now owns cleanup through import/reset/unmount.
            return;
          }
          setState(previous => ({ ...previous, confirmationPending: result.status === 'confirming' }));
          timer.current = setTimeout(poll, Math.max(2000, created.pollIntervalMs || 0));
        } catch (error) {
          if (generation.current !== current) return;
          close(session.current);
          session.current = null;
          setState({ phase: 'error', message: error.message });
        }
      };
      timer.current = setTimeout(poll, Math.max(2000, created.pollIntervalMs || 0));
    } catch (error) {
      if (generation.current === current) setState({ phase: 'error', message: error.message });
    } finally { if (generation.current === current) busy.current = false; }
  }

  const waiting = state.phase === 'waiting';
  const confirming = waiting && state.confirmationPending;
  const refreshLabel = en ? 'Get a new QR code' : '重新获取二维码';

  return <section className="official-qr-login" aria-label={en ? 'Scan to import' : '扫码导入'}>
    <div className="official-qr-card">
      <header className="official-qr-card__header">
        {waiting && <button type="button" className="official-qr-card__action official-qr-card__action--refresh"
          aria-label={refreshLabel} title={refreshLabel} disabled={disabled} onClick={start}><RefreshCw size={20} /></button>}
        <div className="official-qr-card__heading">
          <h3>{en ? 'Scan to log in' : '扫码登录'}</h3>
          <span>{en ? 'CN ACCOUNT · SITE IMPORT' : '国服账号 · 本站导入'}</span>
        </div>
        {state.phase !== 'idle' && <button type="button" className="official-qr-card__action official-qr-card__action--close"
          aria-label={en ? 'Close QR code' : '关闭二维码'} title={en ? 'Close QR code' : '关闭二维码'} onClick={reset}><X size={21} /></button>}
      </header>

      <div className="official-qr-card__body">
        <div className={`official-qr-card__code${confirming ? ' official-qr-card__code--confirming' : ''}`}>
          {waiting && <QRCodeSVG value={state.scanUrl} size={184} marginSize={0} title={en ? 'Official login QR code' : '官方登录二维码'} />}
          {state.phase === 'idle' && <button type="button" className="official-qr-card__start" disabled={disabled} onClick={start}>
            <QrCode size={56} strokeWidth={1.25} aria-hidden="true" />
            <span>{en ? 'Get login QR code' : '获取登录二维码'}</span>
          </button>}
          {state.phase === 'creating' && <div className="official-qr-card__overlay" role="status">
            <RefreshCw className="official-qr-card__spinner" size={32} strokeWidth={1.5} aria-hidden="true" />
            <span>{en ? 'Loading, please wait' : '正在加载，请稍后'}</span>
          </div>}
          {confirming && <div className="official-qr-card__overlay" role="status">
            <span className="official-qr-card__success"><Check size={30} strokeWidth={2.5} aria-hidden="true" /></span>
            <strong>{en ? 'Scanned successfully' : '扫码成功'}</strong>
            <span>{en ? 'Please confirm on your phone' : '已扫码，请在手机上确认登录'}</span>
          </div>}
          {state.phase === 'error' && <div className="official-qr-card__overlay">
            <button type="button" className="official-qr-card__retry" disabled={disabled} onClick={start} aria-label={refreshLabel}>
              <RefreshCw size={30} strokeWidth={1.5} aria-hidden="true" />
              <span>{en ? 'Tap to refresh' : '点击刷新二维码'}</span>
            </button>
          </div>}
        </div>

        <div className="official-qr-card__apps">
          <span>{en ? 'Supported apps:' : '支持 App：'}</span>
          <div className="official-qr-card__app-list">
            {SCAN_APPS.map(app => <span key={app.name} className="official-qr-card__app" tabIndex={0}>
              <img src={app.icon} alt={en ? app.nameEn : app.name} width="30" height="30" referrerPolicy="no-referrer" />
              <span className="official-qr-card__tooltip" aria-hidden="true">{en ? app.nameEn : app.name}</span>
            </span>)}
          </div>
        </div>
      </div>
    </div>

    <div className="official-qr-login__notes">
      {waiting && !confirming && <p role="status">{en ? 'Scan with a supported app, then confirm on your phone.' : '请使用以上 App 扫码，并在手机上确认登录。'}</p>}
      {state.phase === 'error' && <p role="alert" className="official-qr-login__error">{state.message}</p>}
      <p>{en ? 'Check the game account and server after scanning. For this import only.' : '扫码后请核对游戏账号与区服，凭证仅本次导入使用。'}</p>
      <details>
        <summary>{en ? 'About credential cleanup' : '凭证清除说明'}</summary>
        <p>{en
          ? 'Login credentials stay on the server and are cleared after use. This does not sign out other devices or revoke your HG account authorization.'
          : '登录凭证留在后端，使用完成后清除。此操作不会退出其他设备，也不代表撤销鹰角账号授权。'}</p>
      </details>
    </div>
  </section>;
}
