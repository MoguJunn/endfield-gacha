import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/index.js';
import WorkbenchAccountEditor from '../WorkbenchAccountEditor.jsx';
import { buildPoolLedgerEntry, createWorkbenchDraft, getWorkbenchStorageKey } from '../../../../shared/dataWorkbench.js';
import { readWorkbenchSession, writeWorkbenchSession, WORKBENCH_DRAFT_TTL_MS } from '../workbenchStorage.js';
import * as service from '../../../services/dataWorkbenchService.js';
import { getMobileTabFromPath, resolvePlatformPath } from '../../../constants/appRoutes.js';

const input = vi.hoisted(() => ({ result: { entries: [] }, props: null }));
vi.mock('../../../services/dataWorkbenchService.js', () => ({
  loadWorkbenchContext: vi.fn(),
  validateWorkbenchWorkspace: vi.fn(),
  commitWorkbenchEntries: vi.fn(),
  getWorkbenchCommit: vi.fn(),
}));
// These tests exercise the workspace contract, while the input modules have their own tests.
vi.mock('../WorkbenchQuestionnaire.jsx', () => ({ default: props => {
  input.props = props;
  return <div role="dialog" aria-label="问卷测试录入"><button onClick={() => props.onApply(input.result)}>应用测试录入</button><button onClick={props.onClose}>关闭测试录入</button></div>;
} }));
vi.mock('../WorkbenchScreenshotImport.jsx', () => ({ default: props => {
  input.props = props;
  return <div role="dialog" aria-label="截图测试录入"><button onClick={() => props.onApply(input.result)}>应用测试录入</button><button onClick={props.onClose}>关闭测试录入</button></div>;
} }));
vi.mock('../WorkbenchConversionGuide.jsx', () => ({ default: props => {
  input.props = props;
  return <div role="dialog" aria-label="文件测试录入"><button onClick={() => props.onApply(input.result)}>应用测试录入</button><button onClick={props.onClose}>关闭测试录入</button></div>;
} }));

const scope = { gameUid: '123', serverScope: '1' };
const pools = [{ id: 'pool', name: '测试池', type: 'limited', rosterEntityIds: ['char', 'five', 'four-a', 'four-b'] }];
const entities = [
  { id: 'char', name: '测试角色', type: 'character', rarity: 6 },
  { id: 'five', name: '测试五星', type: 'character', rarity: 5 },
  { id: 'four-b', name: '四星乙', type: 'character', rarity: 4 },
  { id: 'four-a', name: '四星甲', type: 'character', rarity: 4 },
];
const props = { ownerId: 'owner', scope, pools, entities, currentPoolId: 'pool', onRefresh: vi.fn() };
const render = view => renderView(view, { wrapper: I18nProvider });
const detail = (extra = {}) => ({ entryId: crypto.randomUUID(), kind: 'detail', poolId: 'pool', timePrecision: 'second', reviewState: 'unreviewed',
  values: { entityId: 'char', timestamp: '2026-01-23T12:00:00Z', quantity: 1, drawMethod: 'normal' }, ...extra });
const official = (extra = {}) => ({ id: 'official-1', gameUid: '123', serverScope: '1', poolId: 'pool', characterId: 'char', name: '测试角色', rarity: 6,
  timestamp: '2026-01-22T12:00:00Z', seqId: '123456', editVersion: 3, isFree: false, isInfoBook: false, ...extra });
function persist(entries = [detail()], extra = {}, ownerId = 'owner', accountScope = scope) {
  const draft = { ...createWorkbenchDraft({ ownerId, scope: accountScope }), entries, ...extra };
  writeWorkbenchSession({ draft, expiresAt: Date.now() + WORKBENCH_DRAFT_TTL_MS });
  return draft;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function loaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: '开始导入／修改' })).toBeEnabled());
}
async function applyInput(result, method = /逐卡池问卷/) {
  input.result = result;
  if (!screen.queryByRole('dialog', { name: '开始导入／修改' })) fireEvent.click(screen.getByRole('button', { name: '开始导入／修改' }));
  fireEvent.click(screen.getByRole('button', { name: method }));
  fireEvent.click(await screen.findByRole('button', { name: '应用测试录入' }));
}
async function validate() {
  fireEvent.click(screen.getByRole('button', { name: '规则验证', exact: true }));
  await screen.findByRole('region', { name: '规则验证结果' });
}
async function editHistory(notes = '核对原始记录') {
  fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
  const dialog = screen.getByRole('dialog', { name: '修改原有明细' });
  fireEvent.change(within(dialog).getByLabelText('修改原因'), { target: { value: notes } });
  fireEvent.click(within(dialog).getByRole('button', { name: '返回卡片核对' }));
}

beforeEach(() => {
  cleanup();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  sessionStorage.clear();
  vi.resetAllMocks();
  input.result = { entries: [] };
  input.props = null;
  service.loadWorkbenchContext.mockResolvedValue({ entries: [], history: [] });
  service.validateWorkbenchWorkspace.mockImplementation(async payload => ({ preview: { canCommit: true, issues: [], warnings: [], checks: [] }, validationToken: `token-${payload.draftRevision}`, draftRevision: payload.draftRevision }));
  service.commitWorkbenchEntries.mockResolvedValue({ saved: 1 });
  props.onRefresh.mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe('workbench account workspace', () => {
  it('retains the original locator when editing a staged record after moving it to another pool', async () => {
    service.loadWorkbenchContext.mockResolvedValue({ entries: [], history: [official()] });
    const other = { id: 'other', name: '另一池', type: 'limited', rosterEntityIds: ['char', 'five'] };
    const view = render(<WorkbenchAccountEditor {...props} pools={[...pools, other]} />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
    let dialog = screen.getByRole('dialog', { name: '修改原有明细' });
    fireEvent.click(within(dialog).getByRole('combobox', { name: '卡池' }));
    fireEvent.click(within(dialog).getByRole('option', { name: /另一池/ }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: '角色／武器' }));
    fireEvent.click(within(dialog).getByRole('option', { name: /测试角色/ }));
    fireEvent.change(within(dialog).getByLabelText('修改原因'), { target: { value: '修正所属卡池' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '返回卡片核对' }));
    fireEvent.click(view.container.querySelector('[data-pool-id="other"]'));
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
    dialog = screen.getByRole('dialog', { name: '修改原有明细' });
    fireEvent.click(within(dialog).getByRole('combobox', { name: '角色／武器' }));
    fireEvent.click(within(dialog).getByRole('option', { name: /测试五星/ }));
    fireEvent.change(within(dialog).getByLabelText('修改原因'), { target: { value: '继续核对角色' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '返回卡片核对' }));
    await validate();
    const payload = service.validateWorkbenchWorkspace.mock.calls[0][0];
    expect(payload.historyChanges).toHaveLength(1);
    expect(payload.historyChanges[0]).toMatchObject({ recordId: 'official-1', currentPoolId: 'pool', seqId: '123456', expectedEditVersion: 3,
      changes: { poolId: 'other', characterId: 'five' } });
  });

  it('opens the input chooser only after confirming that the account is empty', async () => {
    const context = deferred();
    service.loadWorkbenchContext.mockReturnValueOnce(context.promise);
    render(<WorkbenchAccountEditor {...props} />);
    expect(screen.getByText('正在读取账号已有记录…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => context.resolve({ entries: [], history: [] }));
    expect(screen.getByRole('dialog', { name: '开始导入／修改' })).toBeInTheDocument();
    expect(service.loadWorkbenchContext).toHaveBeenCalledWith(scope);
    expect(service.validateWorkbenchWorkspace).not.toHaveBeenCalled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
    expect(readWorkbenchSession('owner', scope).draft.entries).toEqual([]);
  });

  it('does not misreport a failed account read as an empty account and offers retry', async () => {
    service.loadWorkbenchContext.mockRejectedValueOnce(new Error('账号读取失败'));
    render(<WorkbenchAccountEditor {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('账号读取失败');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('此卡池尚无记录')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始导入／修改' })).toBeDisabled();
    service.loadWorkbenchContext.mockResolvedValueOnce({ entries: [], history: [official()] });
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await loaded();
    expect(screen.getByText('查看此池全部原有明细（1 条）')).toBeInTheDocument();
    expect(service.loadWorkbenchContext).toHaveBeenCalledTimes(2);
  });

  it('isolates local drafts by site owner, game account and server and expires them after 24 hours', () => {
    persist();
    expect(readWorkbenchSession('other', scope)).toBeNull();
    expect(readWorkbenchSession('owner', { ...scope, gameUid: '456' })).toBeNull();
    expect(readWorkbenchSession('owner', { ...scope, serverScope: '2' })).toBeNull();
    expect(readWorkbenchSession('owner', scope).draft.entries).toHaveLength(1);
    expect(readWorkbenchSession('owner', scope, sessionStorage, Date.now() + WORKBENCH_DRAFT_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(getWorkbenchStorageKey('owner', scope))).toBeNull();
  });

  it('edits an official history row on the same page and stages its versioned change without a write', async () => {
    service.loadWorkbenchContext.mockResolvedValue({ entries: [], history: [official()] });
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
    const dialog = screen.getByRole('dialog', { name: '修改原有明细' });
    expect(within(dialog).getByRole('button', { name: '返回卡片核对' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('combobox', { name: '角色／武器' }));
    fireEvent.click(within(dialog).getByRole('option', { name: /测试五星/ }));
    fireEvent.change(within(dialog).getByLabelText('修改原因'), { target: { value: '星级核对' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '返回卡片核对' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readWorkbenchSession('owner', scope).draft.historyChanges).toEqual([expect.objectContaining({
      recordId: 'official-1', expectedEditVersion: 3, seqId: '123456', currentPoolId: 'pool', reason: '星级核对',
      changes: expect.objectContaining({ characterId: 'five', drawMethod: 'normal' }),
    })]);
    expect(service.validateWorkbenchWorkspace).not.toHaveBeenCalled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it.each([[/逐卡池问卷/, 'manual'], [/小黑盒截图识别/, 'xhh'], [/转换其他平台文件/, 'file']])('stages %s input and waits for a separate validation and save click', async (method, source) => {
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    const entry = detail({ source });
    await applyInput({ entries: [entry] }, method);
    expect(readWorkbenchSession('owner', scope).draft.entries).toEqual([entry]);
    expect(service.validateWorkbenchWorkspace).not.toHaveBeenCalled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
    await validate();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeEnabled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('builds deterministic four-star fill from incomplete ledger input without inventing accurate evidence', async () => {
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    const raw = { entryId: 'stable-ledger', kind: 'pool-ledger', poolId: 'pool', values: { drawMethod: 'normal', coverageMode: 'pool', totalPulls: 50, sixStarCount: 1, fiveStarCount: 4, complete: false, acquisitions: [] } };
    await applyInput({ entries: [raw] });
    const entry = readWorkbenchSession('owner', scope).draft.entries[0];
    expect(entry).toEqual(buildPoolLedgerEntry(raw, { pools, entities }));
    expect(entry.values.pity).toBeUndefined();
    expect(entry.values.acquisitions).toEqual([]);
    expect(entry.values.inferredFill.count).toBe(45);
    expect(entry.values.inferredFill).toEqual(expect.objectContaining({ seed: 'stable-ledger' }));
    expect(entry.values.inferredRecords).toHaveLength(16);
    expect(entry.values.inferredRecords.every(row => row.derivation === 'inferred' && row.rarity === 4 && !row.timestamp && !row.seqId)).toBe(true);
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('retains incomplete input locally and blocks remote validation without inventing its entity or time', async () => {
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    const incomplete = detail({ values: {}, timePrecision: 'unknown' });
    await applyInput({ entries: [incomplete] });
    await validate();
    expect(readWorkbenchSession('owner', scope).draft.entries[0].values).toEqual({});
    expect(screen.getByRole('region', { name: '规则验证结果' })).toHaveTextContent('请选择真实角色或武器');
    expect(service.validateWorkbenchWorkspace).not.toHaveBeenCalled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
  });

  it('reuses the saved same-pool ledger identity and revision when questionnaire input is applied', async () => {
    const saved = { ...buildPoolLedgerEntry({ entryId: 'saved-ledger-id', poolId: 'pool', values: { totalPulls: 50, fiveStarCount: 4, sixStarCount: 1, complete: false } }, { pools, entities }), id: 'cloud-ledger', revision: 7 };
    service.loadWorkbenchContext.mockResolvedValue({ entries: [saved], history: [official()] });
    render(<WorkbenchAccountEditor {...props} pools={[...pools, { id: 'other-pool', name: '另一个池', type: 'limited' }]} />);
    await loaded();
    const ledgerCard = screen.getAllByRole('article').find(card => card.textContent.includes('整池存档'));
    fireEvent.click(within(ledgerCard).getByRole('button', { name: '编辑内容' }));
    await screen.findByRole('dialog', { name: '问卷测试录入' });
    expect(input.props.mode).toBe('edit');
    expect(input.props.pools.map(pool => pool.id)).toEqual(['pool']);
    expect(input.props.existingHistory).toEqual([expect.objectContaining({ id: 'official-1' })]);
    expect(input.props.existingEntries[0].id).toBe('cloud-ledger');
    expect(input.props.existingEntries[0].scope).toEqual(scope);
    input.result = { entries: [{ entryId: 'new-input-id', kind: 'pool-ledger', poolId: 'pool', values: { drawMethod: 'normal', totalPulls: 51, sixStarCount: 1, fiveStarCount: 4, complete: false, acquisitions: [] } }] };
    fireEvent.click(screen.getByRole('button', { name: '应用测试录入' }));
    const draft = readWorkbenchSession('owner', scope).draft;
    expect(draft.entries).toEqual([]);
    expect(draft.supplementChanges).toEqual([expect.objectContaining({ id: 'cloud-ledger', expectedRevision: 7, action: 'update', entry: expect.objectContaining({ entryId: 'saved-ledger-id', values: expect.objectContaining({ totalPulls: 51 }) }) })]);
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('requires explicit acceptance of verification warnings before save', async () => {
    persist();
    service.validateWorkbenchWorkspace.mockResolvedValue({ preview: { canCommit: true, issues: [], warnings: [{ code: 'incomplete', message: '部分出货时间未知' }] }, validationToken: 'warning-token', draftRevision: 1 });
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    expect(screen.getByText('部分出货时间未知')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: '我已核对以上缺失／推算提示，按当前已知内容保存存档' });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeEnabled();
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('invalidates the validation token after editing a draft and validates the new revision', async () => {
    const draft = persist();
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '重新核对' } });
    fireEvent.click(screen.getByRole('button', { name: '返回卡片核对' }));
    expect(screen.queryByRole('region', { name: '规则验证结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
    await validate();
    expect(service.validateWorkbenchWorkspace).toHaveBeenCalledTimes(2);
    const payload = service.validateWorkbenchWorkspace.mock.calls[1][0];
    expect(payload.draftRevision).toBe(draft.revision + 1);
    expect(payload.entries[0].values.notes).toBe('重新核对');
    expect(payload.commitId).not.toBe(service.validateWorkbenchWorkspace.mock.calls[0][0].commitId);
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('submits new entries and official history changes together with the matching validation token', async () => {
    service.loadWorkbenchContext.mockResolvedValue({ entries: [], history: [official()] });
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await editHistory();
    await applyInput({ entries: [detail()] });
    await validate();
    const previewed = service.validateWorkbenchWorkspace.mock.calls[0][0];
    expect(previewed).toEqual(expect.objectContaining({ mode: 'pool-workspace', scope, draftRevision: 3 }));
    expect(previewed.historyChanges).toHaveLength(1);
    expect(previewed.entries).toHaveLength(1);
    expect(previewed.entries[0].reviewState).toBe('confirmed');
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    await screen.findByText('导入／修改已整体保存，统计已请求刷新。');
    expect(service.commitWorkbenchEntries).toHaveBeenCalledExactlyOnceWith({ ...previewed, validationToken: 'token-3' });
    const saved = readWorkbenchSession('owner', scope).draft;
    expect(saved.entries).toEqual([]);
    expect(saved.historyChanges).toEqual([]);
  });

  it('stages edits to saved supplements with an expected revision in the shared transaction', async () => {
    const saved = { ...detail(), id: 'saved-entry', revision: 4 };
    service.loadWorkbenchContext.mockResolvedValue({ entries: [saved], history: [] });
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '同页修改' } });
    fireEvent.click(screen.getByRole('button', { name: '返回卡片核对' }));
    await validate();
    expect(service.validateWorkbenchWorkspace.mock.calls[0][0]).toEqual(expect.objectContaining({ entries: [], supplementChanges: [expect.objectContaining({ id: 'saved-entry', expectedRevision: 4, action: 'update', entry: expect.objectContaining({ values: expect.objectContaining({ notes: '同页修改' }) }) })] }));
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('retains the local draft after a 409 and requires validation again instead of blind retry', async () => {
    const draft = persist();
    service.commitWorkbenchEntries.mockRejectedValueOnce(Object.assign(new Error('版本冲突，请重新核对'), { status: 409 }));
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突，请重新核对');
    const session = readWorkbenchSession('owner', scope);
    expect(session.draft.entries[0].entryId).toBe(draft.entries[0].entryId);
    expect(session.pendingPayload).toBeNull();
    expect(screen.queryByRole('button', { name: '按原请求重试' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存导入／修改' })).toBeDisabled();
    await validate();
    expect(service.validateWorkbenchWorkspace).toHaveBeenCalledTimes(2);
  });

  it('locks a timed-out request and retries the identical persisted transaction after remount', async () => {
    persist();
    service.commitWorkbenchEntries.mockRejectedValueOnce(new Error('请求超时，结果未知')).mockResolvedValueOnce({ saved: 1 });
    service.getWorkbenchCommit.mockRejectedValueOnce(Object.assign(new Error('尚未确认'), { status: 404 }));
    const first = render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    await screen.findByText('请求超时，结果未知');
    const submitted = service.commitWorkbenchEntries.mock.calls[0][0];
    expect(readWorkbenchSession('owner', scope).pendingPayload).toEqual(submitted);
    expect(screen.getByRole('button', { name: '开始导入／修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑内容' })).toBeDisabled();
    first.unmount();
    render(<WorkbenchAccountEditor {...props} />);
    await screen.findByText('提交结果尚未确认，内容暂时锁定以避免重复保存。');
    fireEvent.click(screen.getByRole('button', { name: '查询提交结果' }));
    await screen.findByText('尚未查到提交结果，可按原请求重试。');
    expect(service.getWorkbenchCommit).toHaveBeenCalledWith(submitted.commitId);
    fireEvent.click(screen.getByRole('button', { name: '按原请求重试' }));
    await screen.findByText('导入／修改已整体保存，统计已请求刷新。');
    expect(service.commitWorkbenchEntries).toHaveBeenCalledTimes(2);
    expect(service.commitWorkbenchEntries.mock.calls[1][0]).toEqual(submitted);
    expect(service.validateWorkbenchWorkspace).toHaveBeenCalledTimes(1);
    expect(readWorkbenchSession('owner', scope).draft.entries).toEqual([]);
  });

  it('does not submit if the browser cannot retain the exact pending transaction', async () => {
    persist();
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未能保留精确提交请求');
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('separates a successful save from a failed analysis refresh', async () => {
    persist();
    props.onRefresh.mockRejectedValueOnce(new Error('refresh failed'));
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    await screen.findByText('数据已整体保存，列表或统计刷新暂时失败，请重试刷新。');
    expect(screen.queryByRole('button', { name: '按原请求重试' })).not.toBeInTheDocument();
    expect(readWorkbenchSession('owner', scope).draft.entries).toEqual([]);
  });

  it('ignores late context responses after changing the site owner', async () => {
    const loading = deferred();
    service.loadWorkbenchContext.mockReturnValueOnce(loading.promise);
    const nextScope = { gameUid: '456', serverScope: '2' };
    persist([detail()], {}, 'new-owner', nextScope);
    const view = render(<WorkbenchAccountEditor key="owner-a" {...props} />);
    view.rerender(<WorkbenchAccountEditor key="owner-b" {...props} ownerId="new-owner" scope={nextScope} />);
    await loaded();
    await act(async () => loading.resolve({ entries: [], history: [official({ name: '旧账号记录' })] }));
    expect(screen.queryByText('查看此池全部原有明细（1 条）')).not.toBeInTheDocument();
    expect(readWorkbenchSession('new-owner', nextScope).draft.entries).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores late validation responses when the keyed owner/account session changes', async () => {
    persist();
    const checking = deferred();
    service.validateWorkbenchWorkspace.mockReturnValueOnce(checking.promise);
    const view = render(<WorkbenchAccountEditor key="a" {...props} />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '规则验证' }));
    await waitFor(() => expect(service.validateWorkbenchWorkspace).toHaveBeenCalledTimes(1));
    const other = { gameUid: '456', serverScope: '2' };
    view.rerender(<WorkbenchAccountEditor key="b" {...props} ownerId="other-owner" scope={other} />);
    await loaded();
    await act(async () => checking.resolve({ preview: { canCommit: true, issues: [], warnings: [] }, validationToken: 'late-token', draftRevision: 1 }));
    expect(screen.queryByRole('region', { name: '规则验证结果' })).not.toBeInTheDocument();
    expect(readWorkbenchSession('owner', scope).draft.entries).toHaveLength(1);
    expect(readWorkbenchSession('other-owner', other).draft.entries).toEqual([]);
  });

  it('does not clear the old pending draft or refresh the new owner after a late save response', async () => {
    persist();
    const committing = deferred();
    service.commitWorkbenchEntries.mockReturnValueOnce(committing.promise);
    const view = render(<WorkbenchAccountEditor key="a" {...props} />);
    await loaded();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    await waitFor(() => expect(service.commitWorkbenchEntries).toHaveBeenCalledTimes(1));
    const submitted = service.commitWorkbenchEntries.mock.calls[0][0];
    const other = { gameUid: '456', serverScope: '2' };
    view.rerender(<WorkbenchAccountEditor key="b" {...props} ownerId="other-owner" scope={other} />);
    await loaded();
    await act(async () => committing.resolve({ saved: 1 }));
    expect(readWorkbenchSession('owner', scope).pendingPayload).toEqual(submitted);
    expect(readWorkbenchSession('owner', scope).draft.entries).toHaveLength(1);
    expect(readWorkbenchSession('other-owner', other).draft.entries).toEqual([]);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('导入／修改已整体保存，统计已请求刷新。')).not.toBeInTheDocument();
  });

  it('excludes already skipped drafts from validation and retains them after saving active entries', async () => {
    const skipped = detail({ values: {}, timePrecision: 'unknown', reviewState: 'skipped' });
    const draft = persist([detail(), skipped]);
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    await validate();
    expect(service.validateWorkbenchWorkspace.mock.calls[0][0].entries).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '保存导入／修改' }));
    await screen.findByText('导入／修改已整体保存，统计已请求刷新。');
    expect(readWorkbenchSession('owner', scope).draft.entries).toEqual([draft.entries[1]]);
  });

  it('shows recent timeline times first while edits still target the original entry identity', async () => {
    const later = detail();
    const earlier = detail({ values: { ...later.values, timestamp: '2026-01-22T12:00:00Z', notes: '更早的记录' } });
    persist([later, earlier]);
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    const cards = screen.getAllByRole('article');
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['草稿条目 1', '草稿条目 2']);
    fireEvent.click(within(cards[1]).getByRole('button', { name: '编辑内容' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '修改早期记录' } });
    fireEvent.click(screen.getByRole('button', { name: '返回卡片核对' }));
    const entries = readWorkbenchSession('owner', scope).draft.entries;
    expect(entries.find(entry => entry.entryId === earlier.entryId).values.notes).toBe('修改早期记录');
    expect(entries.find(entry => entry.entryId === later.entryId).values.notes).toBeUndefined();
  });

  it('uses inclusive ledger counts without adding the same official history or inventing pity', async () => {
    const ledger = buildPoolLedgerEntry({ entryId: 'inclusive-ledger', poolId: 'pool', values: { drawMethod: 'normal', coverageMode: 'pool', totalPulls: 50, sixStarCount: 1, fiveStarCount: 4, complete: false, acquisitions: [] } }, { pools, entities });
    persist([ledger]);
    service.loadWorkbenchContext.mockResolvedValue({ entries: [], history: [official()] });
    render(<WorkbenchAccountEditor {...props} />);
    await loaded();
    const overview = within(screen.getByLabelText('账号数据总览'));
    expect(overview.getByText('总抽数').nextElementSibling).toHaveTextContent('50');
    expect(overview.getByText('六星', { exact: true }).nextElementSibling).toHaveTextContent('1');
    expect(overview.getByText('五星', { exact: true }).nextElementSibling).toHaveTextContent('4');
    expect(screen.getByRole('region', { name: '测试池补录卡片' })).toHaveTextContent('整池存档');
    expect(readWorkbenchSession('owner', scope).draft.entries[0].values.pity).toBeUndefined();
    expect(service.commitWorkbenchEntries).not.toHaveBeenCalled();
  });

  it('preserves the workbench destination across platform switches', () => {
    expect(getMobileTabFromPath('/m/data-workbench')).toBe('dataWorkbench');
    expect(resolvePlatformPath('/data-workbench', 'mobile')).toBe('/m/data-workbench');
    expect(resolvePlatformPath('/m/data-workbench', 'desktop')).toBe('/data-workbench');
  });
});
