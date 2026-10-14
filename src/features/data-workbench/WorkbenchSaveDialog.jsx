import React from 'react';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import WorkbenchDialog from './WorkbenchDialog.jsx';

export default function WorkbenchSaveDialog({ local, draft, pools, entities, preview, busy, pending, error, message, onClose, onPreview, onCommit, onCheckCommit, onEdit, onSkipIncomplete }) {
  const blocked = local.entries.map((result, index) => ({ ...result, index })).filter(result => !result.valid && !result.skipped);
  const metrics = preview?.metrics;
  return <WorkbenchDialog title={pending ? '确认提交结果' : '确认本次保存'} onClose={onClose} busy={busy}
    description="检查要保存的内容和统计影响，确认后写入当前账号。"
    footer={pending ? <>
      <button className="wb-button" disabled={busy} onClick={onCheckCommit}>查询提交结果</button>
      <button className="wb-button wb-button--primary" disabled={busy} onClick={onCommit}>原提交重试</button>
    </> : <>
      <button className="wb-button" disabled={busy} onClick={onClose}>返回核对</button>
      {preview ? <button className="wb-button wb-button--primary" disabled={busy || !preview.canCommit} onClick={onCommit}><Check size={16} /> 确认保存到云端</button>
        : <button className="wb-button wb-button--primary" disabled={busy || blocked.length > 0 || local.counts.total === local.counts.skipped} onClick={onPreview}>
          {busy ? <RefreshCw size={16} className="wb-spinning" /> : <ArrowRight size={16} />} {busy ? '正在检查…' : '重新检查'}
        </button>}
    </>}>
    <div className="wb-save-summary"><strong>{local.counts.total - local.counts.skipped} 条本次保存</strong><span>{local.counts.skipped} 条暂不保存</span></div>
    {error && <p role="alert" className="wb-notice wb-notice--error">{error}</p>}
    {pending ? <p role="status">{message || '提交结果待确认，草稿暂时锁定。请查询结果，或使用原提交重试。'}</p>
      : busy ? <p role="status" className="wb-save-loading"><RefreshCw size={22} className="wb-spinning" /> 正在检查重复记录与统计影响…</p>
      : blocked.length > 0 ? <>
        <p className="wb-save-explanation">有 {blocked.length} 条内容需要补齐。可以修改，也可以本次先不保存这些条目。</p>
        <ul className="wb-save-problems">{blocked.map(({ entry, issues, index }) => <li key={entry.entryId}>
          <div><strong>{pools.find(pool => pool.id === entry.poolId)?.name || '未选择卡池'}{entry.values.entityId ? ` · ${entities.find(entity => entity.id === entry.values.entityId)?.name || entry.values.entityId}` : ''}</strong><p>{issues.map(issue => issue.message).join('；')}</p></div>
          <button className="wb-button" onClick={() => onEdit(index)}>修改</button>
        </li>)}</ul>
        {local.counts.total - local.counts.skipped > blocked.length && <button className="wb-button" onClick={onSkipIncomplete}>本次跳过 {blocked.length} 条，继续检查</button>}
      </> : <>
        <ul className="wb-save-items">{draft.entries.filter(entry => entry.reviewState !== 'skipped').map(entry => <li key={entry.entryId}>
          <span>{pools.find(pool => pool.id === entry.poolId)?.name || '未选择卡池'}</span>
          <span>{entry.kind.includes('summary') ? `${entry.values.totalPulls ?? '未知'} 抽汇总` : `${entities.find(entity => entity.id === entry.values.entityId)?.name || '获取记录'} · ${entry.kind === 'six-star-interval' ? `${entry.values.intervalPulls} 抽出货` : `${entry.values.quantity} 件`}`}</span>
        </li>)}</ul>
        {preview?.issues?.length > 0 && <ul role="alert" className="wb-save-problems">{preview.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
        {metrics && <div className="wb-save-metrics">
          <div aria-label={`合并后已知抽数：${metrics.combined.totalPulls}`}><span>合并后已知抽数</span><strong>{metrics.combined.totalPulls}<small> 抽</small></strong></div>
          <div><span>已知六星</span><strong>{metrics.combined.sixStarCount}<small> 个</small></strong></div>
          <div><span>同范围六星出率</span><strong>{metrics.rates?.sixStarRate == null ? '未知' : `${(metrics.rates.sixStarRate * 100).toFixed(2)}%`}</strong></div>
        </div>}
        {metrics && <details className="wb-optional"><summary>资源与覆盖详情</summary>
          <p>武库配额：{metrics.resource?.arsenalQuota ?? 0}；集成配额：{metrics.resource?.aicSupplemental ?? 0}。</p>
          <p>明确出货间隔：{metrics.intervals?.length || 0} 个；四星数量未知的范围：{metrics.coverage?.unknownFourStar || 0} 个。</p>
          <p>资源证据不足：{metrics.resource?.unknown?.length || 0} 项。汇总与明细按范围扣减，缺失信息保留未知。</p>
        </details>}
      </>}
  </WorkbenchDialog>;
}
