import React, { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, RotateCcw } from 'lucide-react';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import { listAccountDataRevisions, previewAccountDataRevert, revertAccountDataRevision } from '../../services/dataWorkbenchService.js';

export default function WorkbenchRevisionDialog({ pools, onClose, onReverted }) {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    listAccountDataRevisions().then(value => { if (alive.current) setData(value); })
      .catch(failure => { if (alive.current) setError(failure.message); });
    return () => { alive.current = false; };
  }, []);
  async function run(action) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) {
      if (alive.current) {
        setError(failure.message);
        if (failure.status >= 400 && failure.status < 500) { setPending(null); setPreview(null); setAccepted(false); }
      }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function inspect(version) {
    setMessage(''); setAccepted(false); setPreview(null);
    const result = await previewAccountDataRevert(version.id);
    if (alive.current) setPreview(result);
  }
  async function revert() {
    const request = pending || { targetId: preview.targetId, token: preview.token, requestId: crypto.randomUUID() };
    setPending(request);
    const result = await revertAccountDataRevision(request);
    setPending(null); setPreview(null); setAccepted(false);
    setMessage(`已撤回 ${result.changed} 条记录的变化，撤回本身已记为新版本。`);
    setData(await listAccountDataRevisions());
    await onReverted();
  }
  const counts = preview?.changes.reduce((result, row) => ({ ...result, [row.operation]: (result[row.operation] || 0) + 1 }), {});
  const scopes = [...new Set(preview?.changes.map(row => `${row.gameUid} · ${row.serverScope}`) || [])];
  const affectedPools = [...new Set((preview?.changes.flatMap(row => [row.poolId, row.restoredPoolId]) || [])
    .filter(Boolean).map(id => pools.find(pool => String(pool.id) === String(id))?.name || id))];
  return <WorkbenchDialog title="修改记录与撤回" onClose={onClose} busy={busy || Boolean(pending)}
    description="保留最近 180 天内的最近 5 次数据修改。记录覆盖此登录用户的全部游戏账号。"
    footer={<>
      <button className="wb-button" disabled={busy || Boolean(pending)} onClick={onClose}>关闭</button>
      {preview && <button className="wb-button wb-button--primary" disabled={busy || !accepted || !preview.changes.length}
        onClick={() => run(revert)}><RotateCcw size={15} />确认撤回</button>}
      {pending && !busy && <button className="wb-button wb-button--primary" onClick={() => run(revert)}>按原请求重试撤回</button>}
    </>}>
    <div className="wb-revisions">
      {error && <p className="wb-notice wb-notice--error" role="alert">{error}</p>}
      {message && <p className="wb-notice wb-notice--success" role="status">{message}</p>}
      {pending && !busy && <p className="wb-notice" role="status">撤回结果尚未确认，请按原请求重试以确认结果。</p>}
      <div className="wb-revisions-heading"><strong><History size={16} />最近修改</strong>
        <button className="wb-text-button" disabled={busy || Boolean(pending)} onClick={() => run(async () => {
          setPreview(null); setAccepted(false); setData(await listAccountDataRevisions());
        })}><RefreshCw size={14} />刷新记录</button></div>
      {!data && !error && <p role="status">正在读取修改记录…</p>}
      {data && !data.versions.length && <p>暂无可撤回记录。启用版本记录后的新增、修改和删除，会在保存后出现在这里。</p>}
      {data?.versions.map((version, index) => <article className="wb-revision" key={version.id}>
        <div><strong>{version.kind === 'revert' ? '撤回操作' : '数据修改'} · #{version.id}</strong>
          <small>{new Date(version.createdAt).toLocaleString('zh-CN')} · {version.operationCount} 项变化</small>
          <small>{version.scopes.map(scope => `${scope.gameUid} · ${scope.serverScope}`).join('、')}</small></div>
        <button className="wb-button" disabled={!version.revertible || busy || Boolean(pending)} onClick={() => run(() => inspect(version))}>
          查看撤回最近 {index + 1} 次
        </button>
      </article>)}
      {preview && <section className="wb-revert-preview" aria-label="撤回影响预览">
        <h3>撤回最近 {preview.revisionCount} 次修改</h3>
        <p>回到所选修改之前的状态；该次修改和它之后的修改会一起撤回。</p>
        <ul><li>删除新增记录：{counts.delete || 0} 条</li><li>恢复删除记录：{counts.restore || 0} 条</li><li>还原修改内容：{counts.update || 0} 条</li></ul>
        <p>涉及账号：{scopes.join('、') || '无'}</p>
        <p>涉及卡池：{affectedPools.join('、') || '无'}</p>
        <label className="wb-revert-confirm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} />
          我已核对上述范围，确认撤回这些已保存的数据变化。</label>
      </section>}
    </div>
  </WorkbenchDialog>;
}
