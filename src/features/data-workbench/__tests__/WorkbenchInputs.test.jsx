import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import WorkbenchQuestionnaire from '../WorkbenchQuestionnaire.jsx';
import WorkbenchConversionGuide from '../WorkbenchConversionGuide.jsx';
import { buildWorkbenchConversionTemplate } from '../importConvertPrompt.js';

const scope = { gameUid: 'game-123', serverScope: 'cn-1' };
const pools = [
  { id: 'pool-a', name: '角色池甲', type: 'limited', rosterEntityIds: ['char-a', 'char-b'] },
  { id: 'pool-b', name: '武器池乙', type: 'weapon', rosterEntityIds: ['weapon-a'] },
];
const entities = [
  { id: 'char-a', name: '角色甲', rarity: 6, type: 'character' },
  { id: 'char-b', name: '角色乙', rarity: 6, type: 'character' },
  { id: 'weapon-a', name: '武器甲', rarity: 6, type: 'weapon' },
];
const common = { scope, pools, entities, selectedPoolId: 'pool-a' };
const handlers = () => ({ onApply: vi.fn(), onClose: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function beginQuestionnaire() {
  act(() => vi.advanceTimersByTime(15000));
  fireEvent.click(screen.getByRole('button', { name: '我已阅读，继续' }));
  fireEvent.click(screen.getByRole('button', { name: '开始填写' }));
}
function chooseEntity(name) {
  fireEvent.click(screen.getByRole('combobox', { name: '获得哪位角色？' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
}
async function addToDraft() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '加入本次草稿' }));
  });
}
function convertedPayload() {
  const template = buildWorkbenchConversionTemplate(common);
  template.supplements.workbenchEntries = [
    {
      ...scope,
      entryId: 'portable',
      draftId: 'portable-draft',
      poolId: 'pool-a',
      kind: 'pool-ledger',
      source: 'file',
      derivation: 'declared',
      values: {
        totalPulls: 50,
        acquisitions: [
          { id: 'a', entityId: 'char-a', rarity: 6, quantity: 1, drawMethod: 'gift', timePrecision: 'unknown' },
        ],
      },
    },
  ];
  return JSON.stringify(template);
}

describe('workbench questionnaire', () => {
  it('gates continuing for the full 15 seconds and restarts the gate on every opening', () => {
    const callbacks = handlers();
    const first = render(<WorkbenchQuestionnaire {...common} {...callbacks} />);
    expect(screen.getByText(/请保证填写内容正确，不要凭模糊印象猜测/)).toBeVisible();
    expect(screen.getByText(/自动随机填充四星身份/)).toBeVisible();
    expect(screen.getByText(/随机结果无法保证准确/)).toBeVisible();
    expect(screen.getByRole('button', { name: /我已阅读，继续/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /我已阅读，继续/ }));
    expect(screen.queryByText('这次要填写哪些卡池？')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(14999));
    expect(screen.getByRole('button', { name: /我已阅读，继续/ })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: '我已阅读，继续' })).toBeEnabled();
    first.unmount();
    render(<WorkbenchQuestionnaire {...common} {...callbacks} />);
    expect(screen.getByRole('button', { name: /我已阅读，继续（15 秒）/ })).toBeDisabled();
    expect(callbacks.onApply).not.toHaveBeenCalled();
  });

  it('returns unknown dates and leaves unanswered totals absent, then confirms draft-only application', async () => {
    const callbacks = handlers();
    render(<WorkbenchQuestionnaire {...common} {...callbacks} />);
    beginQuestionnaire();
    expect(screen.getByLabelText('总抽数（包括已有官方记录）')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: '添加一次六星获得' }));
    chooseEntity('角色甲');
    fireEvent.change(screen.getByLabelText('距上次六星多少抽？（六星可填）'), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText('如何获得？'), { target: { value: 'free' } });
    fireEvent.click(screen.getByRole('button', { name: '核对问卷' }));
    await addToDraft();
    const result = callbacks.onApply.mock.calls[0][0];
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: 'pool-ledger',
      poolId: 'pool-a',
      source: 'manual',
      derivation: 'declared',
    });
    expect(result.entries[0].values).not.toHaveProperty('totalPulls');
    expect(result.entries[0].values).not.toHaveProperty('pity');
    expect(result.entries[0].values.acquisitions[0]).toMatchObject({
      entityId: 'char-a',
      rarity: 6,
      intervalPulls: 65,
      drawMethod: 'free',
      timePrecision: 'unknown',
    });
    expect(result.entries[0].values.acquisitions[0]).not.toHaveProperty('timestamp');
    expect(screen.getByRole('status')).toHaveTextContent('尚未保存');
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('selects a subset, preserves previous answers, and reports skips before applying', async () => {
    const callbacks = handlers();
    render(<WorkbenchQuestionnaire {...common} {...callbacks} />);
    act(() => vi.advanceTimersByTime(15000));
    fireEvent.click(screen.getByRole('button', { name: '我已阅读，继续' }));
    expect(screen.getByRole('checkbox', { name: /角色池甲/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /武器池乙/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /武器池乙/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始填写' }));
    fireEvent.change(screen.getByLabelText('总抽数（包括已有官方记录）'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '下一卡池' }));
    expect(screen.getByRole('heading', { name: '武器池乙' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByLabelText('总抽数（包括已有官方记录）')).toHaveValue(25);
    fireEvent.click(screen.getByRole('button', { name: '下一卡池' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过这个卡池' }));
    expect(screen.getByRole('alert')).toHaveTextContent('本次填写的内容不会加入草稿');
    expect(screen.getByRole('heading', { name: '武器池乙' })).toBeInTheDocument();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续填写' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '跳过这个卡池' }));
    fireEvent.click(screen.getByRole('button', { name: '确认跳过' }));
    expect(screen.getByText('已跳过 武器池乙，本次不更新这个卡池。')).toBeInTheDocument();
    await addToDraft();
    expect(callbacks.onApply.mock.calls[0][0]).toMatchObject({
      entries: [{ poolId: 'pool-a', values: { totalPulls: 25 } }],
      warnings: ['已跳过 武器池乙，本次不更新这个卡池。'],
    });
  });

  it('prefills edit mode and produces original history locator and supplement revision', async () => {
    const callbacks = handlers();
    const original = {
      id: 'saved',
      entryId: 'saved-entry',
      kind: 'pool-ledger',
      poolId: 'pool-a',
      revision: 7,
      source: 'file',
      ...scope,
      values: { totalPulls: 80, sixStarCount: 1, acquisitions: [] },
    };
    const history = {
      id: 'history',
      seqId: 'real-seq',
      poolId: 'pool-a',
      character_id: 'char-a',
      rarity: 6,
      ...scope,
      timestamp: '2026-01-23T12:00:00Z',
      editVersion: 2,
    };
    render(
      <WorkbenchQuestionnaire
        {...common}
        {...callbacks}
        mode="edit"
        existingEntries={[original]}
        existingHistory={[history]}
      />
    );
    beginQuestionnaire();
    expect(screen.getByLabelText('总抽数（包括已有官方记录）')).toHaveValue(80);
    expect(screen.getByRole('combobox', { name: '获得哪位角色？' })).toHaveTextContent('角色甲');
    expect(screen.getByLabelText('已知精确时间')).toHaveValue(history.timestamp);
    fireEvent.change(screen.getByLabelText('记得日期吗？'), { target: { value: 'second' } });
    expect(screen.getByLabelText('已知精确时间')).toHaveValue(history.timestamp);
    chooseEntity('角色乙');
    fireEvent.change(screen.getByLabelText('距上次六星的当前垫抽'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '核对问卷' }));
    await addToDraft();
    expect(callbacks.onApply.mock.calls[0][0]).toMatchObject({
      entries: [],
      historyChanges: [
        {
          recordId: 'history',
          seqId: 'real-seq',
          currentPoolId: 'pool-a',
          ...scope,
          expectedEditVersion: 2,
          changes: { characterId: 'char-b' },
        },
      ],
      supplementChanges: [
        {
          id: 'saved',
          expectedRevision: 7,
          action: 'update',
          entry: { entryId: 'saved-entry', source: 'file', values: { totalPulls: 80, pity: 0, acquisitions: [] } },
        },
      ],
    });
    expect(callbacks.onApply.mock.calls[0][0].historyChanges[0].changes).toEqual({ characterId: 'char-b' });
  });
});

describe('workbench conversion guide', () => {
  it('copies a scoped prompt and downloads a credential-free current template', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let downloaded;
    const previousCreate = URL.createObjectURL;
    const previousRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob) => {
      downloaded = blob;
      return 'blob:conversion';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<WorkbenchConversionGuide {...common} {...handlers()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制转换提示词' }));
    });
    expect(writeText.mock.calls[0][0]).toContain('DeepSeek');
    expect(writeText.mock.calls[0][0]).toContain('game-123');
    fireEvent.click(screen.getByRole('button', { name: '下载 JSON 模板' }));
    expect(downloaded.type).toBe('application/json;charset=utf-8');
    expect(screen.getByRole('status')).toHaveTextContent('已下载');
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  });

  it('checks converted JSON before returning ledger entries and keeps the confirmation open', async () => {
    const callbacks = handlers();
    render(<WorkbenchConversionGuide {...common} {...callbacks} />);
    expect(screen.getByRole('button', { name: '加入本次草稿' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('或粘贴转换后的 JSON'), { target: { value: convertedPayload() } });
    fireEvent.click(screen.getByRole('button', { name: '检查转换内容' }));
    expect(screen.getByText(/日期未知 1 行/)).toBeInTheDocument();
    expect(callbacks.onApply).not.toHaveBeenCalled();
    await addToDraft();
    expect(callbacks.onApply.mock.calls[0][0]).toMatchObject({
      entries: [
        {
          kind: 'pool-ledger',
          source: 'file',
          values: { totalPulls: 50, acquisitions: [{ drawMethod: 'gift', timePrecision: 'unknown' }] },
        },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('尚未保存');
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('reads a converted file into the checker and invalidates the preview after a text change', async () => {
    render(<WorkbenchConversionGuide {...common} {...handlers()} />);
    const file = new File([convertedPayload()], 'converted.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(convertedPayload()) });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('选择转换后的 JSON 文件'), { target: { files: [file] } });
    });
    expect(screen.getByLabelText('或粘贴转换后的 JSON')).toHaveValue(convertedPayload());
    fireEvent.click(screen.getByRole('button', { name: '检查转换内容' }));
    expect(screen.getByRole('button', { name: '加入本次草稿' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('或粘贴转换后的 JSON'), { target: { value: '{}' } });
    expect(screen.getByRole('button', { name: '加入本次草稿' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '检查转换内容' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('internal_json_v3');
  });
});
