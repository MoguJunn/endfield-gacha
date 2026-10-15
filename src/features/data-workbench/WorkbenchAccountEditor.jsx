import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Eye, EyeOff, FileJson, History, ImagePlus, PenLine, RefreshCw, Trash2 } from 'lucide-react';
import { buildPoolLedgerEntry, createWorkbenchDraft, validateWorkbenchEntry } from '../../../shared/dataWorkbench.js';
import { computeWorkbenchMetrics } from '../../../shared/dataWorkbenchMetrics.js';
import { validateWorkbenchRules } from '../../../shared/workbenchRules.js';
import { isWorkbenchPoolUnopened, validateWorkbenchPoolOperations, workbenchPoolUnavailableMessage } from '../../../shared/workbenchPoolAvailability.js';
import { commitWorkbenchEntries, getWorkbenchCommit, loadWorkbenchContext, validateWorkbenchWorkspace } from '../../services/dataWorkbenchService.js';
import { useI18n } from '../../i18n/index.js';
import StatisticsPoolList from '../../components/summary/StatisticsPoolList.jsx';
import { buildWorkspacePayload, readWorkbenchSession, writeWorkbenchSession, WORKBENCH_DRAFT_TTL_MS } from './workbenchStorage.js';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import WorkbenchTimeline from './WorkbenchTimeline.jsx';
import WorkbenchEntryEditor from './WorkbenchEntryEditor.jsx';
import WorkbenchHistoryEditor from './WorkbenchHistoryEditor.jsx';

const Questionnaire = lazy(() => import('./WorkbenchQuestionnaire.jsx'));
const ScreenshotImport = lazy(() => import('./WorkbenchScreenshotImport.jsx'));
const ConversionGuide = lazy(() => import('./WorkbenchConversionGuide.jsx'));
const RevisionDialog = lazy(() => import('./WorkbenchRevisionDialog.jsx'));
const EMPTY_CHANGES = [];
const poolIdOf = row => String(row.poolId ?? row.pool_id ?? '');
const normalizeHistory = row => ({ ...row, id: row.record_id ?? row.id, poolId: row.poolId ?? row.pool_id,
  characterId: row.characterId ?? row.character_id, gameUid: row.gameUid ?? row.game_uid, serverScope: row.serverScope ?? row.server_scope,
  seqId: row.seqId ?? row.seq_id, editVersion: row.editVersion ?? row.edit_version ?? 1,
  isFree: row.isFree ?? row.is_free, isInfoBook: row.isInfoBook ?? row.is_info_book, specialType: row.specialType ?? row.special_type,
  isStandard: row.isStandard ?? row.is_standard, batchId: row.batchId ?? row.batch_id,
});

export default function WorkbenchAccountEditor({ ownerId, scope, pools, entities, currentPoolId, onRefresh, onDirtyChange, accountHeader, autoPromptEnabled = true, catalogReady = true, startRequest = 0, questionnaireReadDelayMs = 15000 }) {
  const { locale, isEnglish } = useI18n();
  const [session, setSession] = useState(() => readWorkbenchSession(ownerId, scope) || { draft: createWorkbenchDraft({ ownerId, scope }), expiresAt: Date.now() + WORKBENCH_DRAFT_TTL_MS });
  const [context, setContext] = useState({ entries: [], history: [], loaded: false });
  const [selectedPoolId, setPoolId] = useState(() => pools.some(pool => pool.id === currentPoolId) ? currentPoolId : session.draft.entries[0]?.poolId || pools[0]?.id);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleHistory, setVisibleHistory] = useState(50);
  const [showFiveStars, setShowFiveStars] = useState(true);
  const [flow, setFlow] = useState('');
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [questionnaireScope, setQuestionnaireScope] = useState(null);
  const [editing, setEditing] = useState(null);
  const [historyEditing, setHistoryEditing] = useState(null);
  const [validation, setValidation] = useState(null);
  const [warningsAccepted, setWarningsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const autoOpened = useRef(false);
  const draft = session.draft;
  const historyChanges = draft.historyChanges || EMPTY_CHANGES;
  const supplementChanges = draft.supplementChanges || EMPTY_CHANGES;
  const activeDrafts = useMemo(() => draft.entries.filter(entry => entry.reviewState !== 'skipped'), [draft.entries]);
  const changeCount = activeDrafts.length + historyChanges.length + supplementChanges.length;
  const locked = busy || Boolean(session.pendingPayload) || !catalogReady;
  const projectedHistory = useMemo(() => context.history.map(row => {
    const change = historyChanges.find(item => String(item.recordId) === String(row.id));
    const entity = change?.changes.characterId && entities.find(item => String(item.id) === String(change.changes.characterId));
    const method = change?.changes.drawMethod;
    return change ? { ...row, ...change.changes, ...(entity ? { name: entity.name, rarity: entity.rarity } : {}), ...(method ? { isFree: method === 'free', is_free: method === 'free', isInfoBook: method === 'info_book', is_info_book: method === 'info_book', specialType: method === 'gift' ? 'gift' : null, special_type: method === 'gift' ? 'gift' : null } : {}), _originalHistory: row, _changed: true } : row;
  }), [context.history, historyChanges, entities]);
  const projectedEntries = useMemo(() => {
    const saved = context.entries.flatMap(row => {
      const change = supplementChanges.find(item => item.id === row.id);
      return change?.action === 'delete' ? [] : [{ ...(change?.entry || row), id: row.id, revision: row.revision, _saved: true, _changed: Boolean(change), reviewState: 'confirmed' }];
    });
    return [...saved, ...activeDrafts.map(entry => ({ ...entry, reviewState: 'confirmed' }))];
  }, [context.entries, supplementChanges, activeDrafts]);
  const metrics = useMemo(() => computeWorkbenchMetrics({ history: projectedHistory, entries: projectedEntries, pools, entities, scope }), [projectedHistory, projectedEntries, pools, entities, scope]);
  const counts = useMemo(() => Object.fromEntries(pools.map(pool => [pool.id, computeWorkbenchMetrics({ history: projectedHistory.filter(row => poolIdOf(row) === String(pool.id)), entries: projectedEntries.filter(row => poolIdOf(row) === String(pool.id)), pools, entities, scope }).combined.totalPulls])), [pools, projectedHistory, projectedEntries, entities, scope]);
  const selectedEntries = projectedEntries.filter(entry => String(entry.poolId) === String(selectedPoolId)).map(entry => ({ ...entry, _inferredRemaining: metrics.coverage.ledgers?.find(ledger => ledger.entryId === entry.entryId)?.inferredRemaining }));
  const selectedHistory = projectedHistory.filter(row => poolIdOf(row) === String(selectedPoolId));
  const selectedPool = pools.find(pool => pool.id === selectedPoolId);
  const selectedUnopened = isWorkbenchPoolUnopened(selectedPool);
  const canSave = validation?.preview?.canCommit && validation.draftRevision === draft.revision && validation.validationToken && (!validation.preview.warnings?.length || warningsAccepted) && !locked;

  async function reload() {
    const next = await loadWorkbenchContext(scope);
    if (alive.current) setContext({ ...next, loaded: true, history: next.history.map(normalizeHistory) });
  }
  useEffect(() => {
    alive.current = true;
    loadWorkbenchContext(scope).then(next => {
      if (!alive.current) return;
      setContext({ ...next, loaded: true, history: next.history.map(normalizeHistory) });
    }).catch(failure => { if (alive.current) setError(failure.message); });
    return () => { alive.current = false; };
    // The parent keys the complete session by owner, account and server.
  }, [scope]);
  useEffect(() => {
    if (!autoPromptEnabled || selectedUnopened || !context.loaded || autoOpened.current || context.entries.length || context.history.length || changeCount || session.pendingPayload) return;
    autoOpened.current = true; setFlow('choose');
  }, [autoPromptEnabled, selectedUnopened, context, changeCount, session.pendingPayload]);
  useEffect(() => { if (startRequest && autoPromptEnabled && !selectedUnopened) setFlow('choose'); }, [startRequest, autoPromptEnabled, selectedUnopened]);
  useEffect(() => { if (!pools.some(pool => pool.id === selectedPoolId) && pools.length) setPoolId(pools[0].id); }, [pools, selectedPoolId]);
  useEffect(() => { setVisibleHistory(50); }, [selectedPoolId]);
  useEffect(() => { setStorageFailed(!writeWorkbenchSession(session)); }, [session]);
  useEffect(() => { onDirtyChange?.(Boolean(changeCount || session.pendingPayload)); }, [changeCount, session.pendingPayload, onDirtyChange]);
  useEffect(() => {
    const guard = event => { if (!changeCount && !session.pendingPayload) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [changeCount, session.pendingPayload]);

  function changeDraft(next) {
    if (locked) return;
    setSession(previous => ({ draft: { ...previous.draft, ...next, revision: previous.draft.revision + 1, updatedAt: new Date().toISOString() }, expiresAt: Date.now() + WORKBENCH_DRAFT_TTL_MS }));
    setValidation(null); setWarningsAccepted(false); setError(''); setMessage('');
  }
  function applyInput(result) {
    const availability = validateWorkbenchPoolOperations({ ...result, history: context.history, existingEntries: context.entries, pools });
    if (availability.length) throw new Error(availability.map(item => item.message).join('；'));
    const generated = (result.entries || []).map(entry => entry.kind === 'pool-ledger' ? buildPoolLedgerEntry(entry, { entities, pools }) : entry);
    const next = [...draft.entries];
    const changes = [...supplementChanges];
    for (const entry of generated) {
      const savedLedger = context.entries.find(row => row.kind === 'pool-ledger' && row.poolId === entry.poolId && row.values.drawMethod === entry.values.drawMethod);
      if (savedLedger) {
        const change = { id: savedLedger.id, expectedRevision: savedLedger.revision, action: 'update', entry: { ...buildPoolLedgerEntry({ ...entry, entryId: savedLedger.entryId }, { entities, pools }), reviewState: 'confirmed' }, reason: '用户核对并修改卡池存档' };
        const index = changes.findIndex(item => item.id === savedLedger.id);
        if (index < 0) changes.push(change); else changes[index] = change;
      } else {
        const index = next.findIndex(row => row.entryId === entry.entryId || row.kind === 'pool-ledger' && entry.kind === 'pool-ledger' && row.poolId === entry.poolId && row.values.drawMethod === entry.values.drawMethod);
        if (index < 0) next.push(entry); else next[index] = entry;
      }
    }
    for (const change of result.supplementChanges || []) {
      const prepared = change.entry?.kind === 'pool-ledger' ? { ...change, entry: buildPoolLedgerEntry(change.entry, { entities, pools }) } : change;
      const index = changes.findIndex(item => item.id === prepared.id);
      if (index < 0) changes.push(prepared); else changes[index] = prepared;
    }
    const historyMap = new Map(historyChanges.map(item => [String(item.recordId), item]));
    for (const change of result.historyChanges || []) {
      const prior = historyMap.get(String(change.recordId));
      historyMap.set(String(change.recordId), { ...change, changes: { ...prior?.changes, ...change.changes } });
    }
    changeDraft({ entries: next, supplementChanges: changes, historyChanges: [...historyMap.values()] });
    setFlow(''); setQuestionnaireScope(null);
    if (result.warnings?.length) setMessage(result.warnings.map(item => typeof item === 'string' ? item : item.message).join('；'));
  }
  async function run(action) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { if (alive.current) setError([failure.message, ...(failure.issues || []).map(item => item.message)].join('；')); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function validate() {
    setValidation(null); setWarningsAccepted(false);
    const rules = validateWorkbenchRules({ entries: projectedEntries, history: context.history, historyChanges, pools, entities });
    const issues = [...rules.issues, ...metrics.issues, ...validateWorkbenchPoolOperations({ ...draft, history: context.history, existingEntries: context.entries, pools })];
    if (issues.length) { setValidation({ draftRevision: draft.revision, preview: { canCommit: false, issues, warnings: rules.warnings } }); return; }
    const reviewed = { ...draft, entries: draft.entries.map(entry => ({ ...entry, reviewState: entry.reviewState === 'skipped' ? 'skipped' : 'confirmed' })), supplementChanges: supplementChanges.map(change => change.entry ? { ...change, entry: { ...change.entry, reviewState: 'confirmed' } } : change) };
    const commitId = globalThis.crypto.randomUUID();
    const payload = buildWorkspacePayload(reviewed, commitId);
    const response = await validateWorkbenchWorkspace(payload);
    if (!alive.current) return;
    setSession(previous => ({ ...previous, draft: reviewed, commitId }));
    setValidation({ ...response, draftRevision: draft.revision });
  }
  async function finish(result) {
    if (!alive.current) return;
    const next = { draft: { ...createWorkbenchDraft({ ownerId, scope }), entries: draft.entries.filter(entry => entry.reviewState === 'skipped') }, expiresAt: Date.now() + WORKBENCH_DRAFT_TTL_MS };
    writeWorkbenchSession(next); setSession(next); setValidation(null); setWarningsAccepted(false);
    setMessage(`已整体保存 ${result.operationCount ?? changeCount} 项导入／修改，正在刷新数据。`);
    try { await reload(); const refreshed = await onRefresh?.(); if (alive.current) setMessage(refreshed?.ok === false ? '数据已保存，统计暂未刷新，可稍后重试。' : '导入／修改已整体保存，统计已请求刷新。'); }
    catch { if (alive.current) setMessage('数据已整体保存，列表或统计刷新暂时失败，请重试刷新。'); }
  }
  async function save() {
    const payload = session.pendingPayload || buildWorkspacePayload(draft, session.commitId, validation.validationToken);
    const pending = { ...session, pendingPayload: payload };
    if (!writeWorkbenchSession(pending)) throw new Error('未能保留精确提交请求，请恢复浏览器存储后再保存');
    setSession(pending);
    try { await finish(await commitWorkbenchEntries(payload)); }
    catch (failure) {
      if (failure.status >= 400 && failure.status < 500 && alive.current) { setSession(previous => ({ ...previous, pendingPayload: null })); setValidation(null); }
      throw failure;
    }
  }
  const inputProps = { scope, pools: questionnaireScope ? pools.filter(pool => pool.id === questionnaireScope) : pools, entities, selectedPoolId, mode: selectedHistory.length || selectedEntries.length ? 'edit' : 'add', existingHistory: projectedHistory, existingEntries: projectedEntries.map(entry => ({ ...entry, scope })), onApply: applyInput, onClose: () => { setFlow(''); setQuestionnaireScope(null); } };
  const editEntry = entry => {
    if (isWorkbenchPoolUnopened(pools.find(pool => pool.id === entry.poolId))) return;
    if (entry._historyRecord) { setHistoryEditing(entry._historyRecord); return; }
    if (entry.kind === 'pool-ledger') { setQuestionnaireScope(entry.poolId); setFlow('questionnaire'); return; }
    setEditing({ original: entry, value: entry });
  };
  const tt = (zh, en) => isEnglish ? en : zh;

  return <div className="wb-pool-workspace">
    <aside className="wb-pool-sidebar ex-theme" aria-label="卡池选择">
      <div className="wb-sidebar-heading"><strong>选择卡池</strong><span className="wb-sidebar-selection">{selectedPool?.name || '选择卡池'}</span><button className="wb-text-button wb-sidebar-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? '收起' : '展开'}</button></div>
      <div className={`wb-sidebar-body ${filtersOpen ? 'is-open' : ''}`}><StatisticsPoolList pools={pools} counts={counts} scope={{ kind: 'pool', poolId: selectedPoolId }} onSelect={next => { setPoolId(next.poolId); setFiltersOpen(false); }} locale={locale} t={tt} allowGroups={false} /></div>
    </aside>
    <main className="wb-workspace-content">
      {accountHeader}
      <div className="wb-overview" aria-label="账号数据总览">
        {[['总抽数', metrics.combined.totalPulls], ['六星', metrics.combined.sixStarCount], ['五星', metrics.combined.fiveStarCount]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString(locale)}</strong></div>)}
        {!!changeCount && <span className="wb-pending-badge">{changeCount} 项待保存</span>}
      </div>
      {storageFailed && <p className="wb-notice wb-notice--warning" role="alert">浏览器未能保存草稿，请勿关闭页面。</p>}
      {error && <p className="wb-notice wb-notice--error" role="alert">{error}</p>}
      {message && <p className="wb-notice wb-notice--success" role="status">{message}</p>}
      <div className="wb-workspace-heading"><div><button type="button" className="wb-button" aria-pressed={showFiveStars} onClick={() => setShowFiveStars(!showFiveStars)}>
        {showFiveStars ? <Eye size={14} /> : <EyeOff size={14} />}{showFiveStars ? '隐藏五星' : '显示五星'}
      </button><button type="button" className="wb-button" disabled={locked || Boolean(changeCount) || !context.loaded}
        title={changeCount ? '请先保存或放弃当前草稿，再查看撤回记录' : '查看最近五次修改和撤回影响'}
        onClick={() => setRevisionsOpen(true)}><History size={14} />修改记录</button></div>
        <button className="wb-button wb-button--primary" disabled={locked || selectedUnopened || !context.loaded || !selectedPool} onClick={() => setFlow('choose')}><PenLine size={15} /> 开始导入／修改</button>
      </div>
      {selectedUnopened && <p className="wb-notice" role="status">{workbenchPoolUnavailableMessage(selectedPool)}</p>}
      {!context.loaded ? <div className="wb-surface p-6"><p role="status">正在读取账号已有记录…</p><button className="wb-button" onClick={() => run(reload)} disabled={busy}><RefreshCw size={14} /> 重试读取</button></div> : <>
        {!selectedEntries.length && !selectedHistory.length && <div className="wb-empty-draft"><ClipboardList size={28} /><h3>此卡池尚无记录</h3><p>可以通过问卷、截图或转换文件开始整理。</p></div>}
        <WorkbenchTimeline key={selectedPoolId} entries={selectedEntries} history={selectedHistory} intervalHistory={projectedHistory} showFiveStars={showFiveStars} pools={pools} entities={entities} validations={selectedEntries.map(entry => validateWorkbenchEntry(entry, { pools, entities }))} renderActions={entry => <button className="wb-row-edit" aria-label="编辑内容" title="点击编辑" disabled={locked || selectedUnopened} onClick={() => editEntry(entry)}><PenLine size={14} /><span>编辑</span></button>} />
        {!!selectedHistory.length && <details className="wb-history-records"><summary>查看此池全部原有明细（{selectedHistory.length} 条）</summary><div>{selectedHistory.slice(0, visibleHistory).map(row => <button key={row.id} className="wb-history-record" disabled={locked || selectedUnopened} onClick={() => setHistoryEditing(row)}><span>{row.rarity}★ {entities.find(item => String(item.id) === String(row.characterId))?.name || row.name || '身份待确认'}</span><small>{row.timestamp ? new Date(row.timestamp).toLocaleString(locale) : '时间未知'}{row._changed ? ' · 修改待保存' : ''}</small><PenLine size={13} /></button>)}</div>{selectedHistory.length > visibleHistory && <button className="wb-button" onClick={() => setVisibleHistory(count => count + 50)}>显示更多原有明细</button>}</details>}
        {!!changeCount && <details className="wb-change-review"><summary>核对本次影响范围（{changeCount} 项）</summary><ul>
          {activeDrafts.map(entry => <li key={entry.entryId}>新增：{pools.find(pool => pool.id === entry.poolId)?.name} · {entry.kind === 'pool-ledger' ? '卡池存档' : '补充信息'}</li>)}
          {historyChanges.map(change => <li key={`history:${change.recordId}`}>原有明细修改：{pools.find(pool => pool.id === change.currentPoolId)?.name}<span>{Object.keys(change.changes).join('、')}</span></li>)}
          {supplementChanges.map(change => <li key={change.id}>{change.action === 'delete' ? '移除旧补充' : '修改已保存补充'}：{pools.find(pool => pool.id === (change.entry?.poolId || context.entries.find(entry => entry.id === change.id)?.poolId))?.name}</li>)}
        </ul><button className="wb-text-button" disabled={locked} onClick={() => { if (window.confirm('放弃本次未保存变化？已有云端数据保留。')) changeDraft({ entries: [], historyChanges: [], supplementChanges: [] }); }}><Trash2 size={13} /> 放弃本次变化</button></details>}
      </>}
      {validation && <section className="wb-validation-results" aria-label="规则验证结果">
        <h3><CheckCircle2 size={17} /> {validation.preview.canCommit ? '已知内容验证通过' : '请先修正以下问题'}</h3>
        {!!validation.preview.issues?.length && <ul>{validation.preview.issues.map((item, index) => <li className="wb-row-warning" key={`issue:${index}`}>{item.message}</li>)}</ul>}
        {!!validation.preview.checks?.length && <details><summary>查看 {validation.preview.checks.length} 项检查</summary><ul>{validation.preview.checks.map((item, index) => <li key={`check:${index}`}>{item.message}</li>)}</ul></details>}
        {!!validation.preview.warnings?.length && <><p>以下内容无法完整验证，保存后仍会保留这些缺口：</p><ul>{validation.preview.warnings.map((item, index) => <li key={index}>{item.message}</li>)}</ul><label><input type="checkbox" checked={warningsAccepted} onChange={event => setWarningsAccepted(event.target.checked)} /> 我已核对以上缺失／推算提示，按当前已知内容保存存档</label></>}
      </section>}
      {session.pendingPayload ? <section className="wb-notice wb-notice--warning"><p>提交结果尚未确认，内容暂时锁定以避免重复保存。</p><button className="wb-button" disabled={busy} onClick={() => run(async () => { try { await finish(await getWorkbenchCommit(session.pendingPayload.commitId)); } catch (failure) { if (failure.status === 404) setMessage('尚未查到提交结果，可按原请求重试。'); else throw failure; } })}>查询提交结果</button><button className="wb-button" disabled={busy} onClick={() => run(save)}>按原请求重试</button></section> : !!changeCount && <div className="wb-submit-bar has-changes">
        <span>{changeCount} 项待保存{canSave && <small><CheckCircle2 size={12} /> 已验证，可以保存</small>}</span>
        <div className="wb-save-actions"><button className="wb-button" disabled={busy || !catalogReady || !changeCount || !context.loaded} onClick={() => run(validate)}>{busy ? '正在处理…' : '规则验证'}</button><button className="wb-button wb-button--primary" disabled={!canSave} onClick={() => run(save)}>保存导入／修改</button></div>
      </div>}
    </main>
    {flow === 'choose' && <WorkbenchDialog title="开始导入／修改" description="选择你手头的信息形式，完成后回到卡片核对。" onClose={() => setFlow('')}>
      <div className="wb-method-options">
        <button onClick={() => setFlow('questionnaire')}><ClipboardList size={23} /><strong>逐卡池问卷</strong><span>有截图或记得数据，逐步回答已知信息</span></button>
        <button onClick={() => setFlow('screenshot')}><ImagePlus size={23} /><strong>小黑盒截图识别</strong><span>适用于小黑盒及高度相似的时间线截图</span></button>
        <button onClick={() => setFlow('conversion')}><FileJson size={23} /><strong>转换其他平台文件</strong><span>下载模板、复制 Prompt，转换后读取草稿</span></button>
      </div>
    </WorkbenchDialog>}
    <Suspense fallback={flow && flow !== 'choose' ? <WorkbenchDialog title="正在加载录入模块" onClose={() => setFlow('')}><p role="status">请稍候…</p></WorkbenchDialog> : null}>
      {revisionsOpen && <RevisionDialog pools={pools} onClose={() => setRevisionsOpen(false)} onReverted={async () => {
        setValidation(null); setWarningsAccepted(false); await reload(); await onRefresh?.();
      }} />}
      {flow === 'questionnaire' && <Questionnaire {...inputProps} readDelayMs={questionnaireReadDelayMs} />}
      {flow === 'screenshot' && <ScreenshotImport {...inputProps} />}
      {flow === 'conversion' && <ConversionGuide {...inputProps} />}
    </Suspense>
    {editing && <WorkbenchDialog title="修改补充内容" onClose={() => setEditing(null)} footer={<><button className="wb-button" onClick={() => setEditing(null)}>取消</button><button className="wb-button wb-button--primary" onClick={() => { const entry = { ...editing.value, reviewState: 'confirmed' }; if (entry.id) applyInput({ supplementChanges: [{ id: entry.id, expectedRevision: entry.revision, action: 'update', entry }] }); else changeDraft({ entries: draft.entries.map(row => row.entryId === entry.entryId ? entry : row) }); setEditing(null); }}>返回卡片核对</button></>}>
      <WorkbenchEntryEditor entry={editing.value} pools={pools} entities={entities} onChange={value => setEditing(previous => ({ ...previous, value }))} />
      <button className="wb-text-button" onClick={() => { if (!window.confirm('将此条移出待保存内容？保存后才更新云端。')) return; if (editing.original.id) applyInput({ supplementChanges: [{ id: editing.original.id, expectedRevision: editing.original.revision, action: 'delete', reason: '用户核对后移除旧补充' }] }); else changeDraft({ entries: draft.entries.filter(row => row.entryId !== editing.original.entryId) }); setEditing(null); }}>移除此条</button>
    </WorkbenchDialog>}
    {historyEditing && <WorkbenchHistoryEditor record={historyEditing} pools={pools} entities={entities} scope={scope} onClose={() => setHistoryEditing(null)} onApply={change => { applyInput({ historyChanges: [change] }); setHistoryEditing(null); }} />}
  </div>;
}
