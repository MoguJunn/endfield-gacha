import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkbenchScreenshotImport from '../../WorkbenchScreenshotImport.jsx';
import { barTokens, bounds, entities, pools } from './tokens.fixture.js';

const mocks = vi.hoisted(() => ({ recognize: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), hints: [] }));
vi.mock('../ocrClient.js', () => ({ createOcrClient: () => mocks }));
vi.mock('../visualCandidates.js', () => ({ addVisualCandidates: async result => ({ ...result, segments: result.segments.map(segment => ({ ...segment, fiveStarHints: mocks.hints })) }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hints = [];
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:local-test');
    static revokeObjectURL = vi.fn();
  });
  mocks.recognize.mockResolvedValue({ tokens: barTokens(), diagnostics: { ...bounds, failedTiles: [] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const upload = () => fireEvent.change(screen.getByLabelText('选择小黑盒截图'), { target: { files: [new File(['fixture'], 'screenshot.png', { type: 'image/png' })] } });
const mount = () => {
  const onApply = vi.fn(); const onClose = vi.fn();
  render(<WorkbenchScreenshotImport pools={pools} entities={entities} selectedPoolId="limited-1" scope={{ gameUid: 'test', serverScope: 'cn' }} onApply={onApply} onClose={onClose} />);
  return { onApply, onClose };
};

describe('截图导入人工确认交互', () => {
  it('取消移除池段时保留修改，确认后才移除整个池段', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await screen.findByText('池段 1 · 熔火灼痕');
    const total = screen.getByLabelText('熔火灼痕 普通抽取总数');
    fireEvent.change(total, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: '移除此池段' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 条获得记录'));
    expect(total).toHaveValue(55);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '移除此池段' }));
    expect(screen.queryByText('池段 1 · 熔火灼痕')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('排除记录需确认，取消时保留数量核对状态，确认后可恢复该行', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await screen.findByText('池段 1 · 熔火灼痕');
    const row = screen.getAllByRole('article')[0];
    const included = within(row).getByRole('checkbox', { name: '记录 1' });
    const counts = screen.getByRole('checkbox', { name: /数量与获得方式已核对/ });
    fireEvent.click(counts);
    fireEvent.click(included);
    expect(included).toBeChecked(); expect(counts).toBeChecked();
    confirm.mockReturnValue(true);
    fireEvent.click(included);
    expect(included).not.toBeChecked(); expect(counts).not.toBeChecked();
    fireEvent.click(included);
    expect(included).toBeChecked();
    expect(within(row).getByRole('combobox', { name: /角色 \/ 武器/ })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('取消重新识别、更换截图或切换类型时保留人工填写内容', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await screen.findByText('池段 1 · 熔火灼痕');
    const total = screen.getByLabelText('熔火灼痕 普通抽取总数');
    fireEvent.change(total, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: '重新识别' }));
    upload();
    fireEvent.click(screen.getByRole('combobox', { name: '截图的卡池类型' }));
    fireEvent.click(screen.getByRole('option', { name: '武器池', exact: true }));
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(total).toHaveValue(55);
    expect(screen.getByRole('combobox', { name: '截图的卡池类型' })).toHaveTextContent('限定角色池');
    expect(mocks.recognize).toHaveBeenCalledTimes(1);
  });

  it('提醒横条下方的五星头像并在继续补充后要求重新核对数量', async () => {
    mocks.hints = [{ entityId: 'char-5', sourceBox: { x: 10, y: 100, width: 30, height: 30 }, candidates: [] }];
    const { onApply } = mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await screen.findByText(/横条下方检测到 1 个头像/);
    fireEvent.click(screen.getByRole('checkbox', { name: /所属卡池正确/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /数量与获得方式已核对/ }));
    fireEvent.click(screen.getByRole('button', { name: '继续添加五星' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: /数量与获得方式已核对/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('所有普通横条数字含义'), { target: { value: 'interval' } });
    screen.getAllByLabelText('我已对照裁图确认身份、抽数含义与获得方式').forEach(input => fireEvent.click(input));
    fireEvent.click(screen.getByRole('checkbox', { name: /数量与获得方式已核对/ }));
    fireEvent.click(screen.getByRole('button', { name: '加入工作台草稿' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0][0].entries[0].values.acquisitions.at(-1)).toMatchObject({ entityId: 'char-5', rarity: 5, quantity: 1 });
  });
  it('确认池、数量与每条身份后，只把草稿传给 onApply', async () => {
    const { onApply } = mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await screen.findByText('池段 1 · 熔火灼痕');
    fireEvent.click(screen.getByRole('button', { name: '加入工作台草稿' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('确认目录中的卡池');
    fireEvent.click(screen.getByRole('checkbox', { name: /所属卡池正确/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /数量与获得方式已核对/ }));
    fireEvent.change(screen.getByLabelText('所有普通横条数字含义'), { target: { value: 'interval' } });
    screen.getAllByLabelText('我已对照裁图确认身份、抽数含义与获得方式').forEach(input => fireEvent.click(input));
    fireEvent.click(screen.getByRole('button', { name: '加入工作台草稿' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0][0].entries[0]).toMatchObject({ source: 'xhh', kind: 'pool-ledger', values: { totalPulls: 40, complete: false } });
    expect(onApply.mock.calls[0][0].entries[0].values.acquisitions[0].intervalPulls).toBe(78);
  });
  it('模型错误明确显示，仍可重新选择截图', async () => {
    mocks.recognize.mockRejectedValue(new Error('本地模型资源缺失'));
    mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本地模型资源缺失');
    expect(screen.getByRole('button', { name: '开始识别' })).toBeEnabled();
  });
  it('识别中关闭弹窗终止旧任务，不会把后到的结果加入草稿', async () => {
    let complete;
    mocks.recognize.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const { onApply, onClose } = mount(); upload(); fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
    await waitFor(() => expect(mocks.recognize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(mocks.cancel).toHaveBeenCalled();
    complete({ tokens: barTokens(), diagnostics: { ...bounds, failedTiles: [] } });
    await waitFor(() => expect(screen.queryByText('池段 1 · 熔火灼痕')).not.toBeInTheDocument());
    expect(onApply).not.toHaveBeenCalled();
  });
});
