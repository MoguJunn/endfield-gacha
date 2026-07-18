import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportStatus } from '../importStatus.js';
import { ImportReviewPanel } from '../components/OfficialImportContent.jsx';

const reviewRecords = [
  {
    ordinal: 0,
    itemName: null,
    quality: null,
    itemType: null,
    poolId: 'pool-a',
    timestamp: null,
    seqId: '10',
    selectedAction: 'skip',
    issues: [{
      code: 'MISSING_ITEM_NAME',
      severity: 'blocking',
      message: '这条记录缺少物品名称，无法安全识别。',
    }],
  },
  {
    ordinal: 1,
    itemName: '余烬',
    quality: 6,
    itemType: 'character',
    poolId: 'pool-a',
    timestamp: '2026-07-11T10:00:00.000Z',
    seqId: '11',
    selectedAction: 'keep',
    issues: [],
  },
];

const importSummary = {
  review: {
    issueRecords: 1,
    blockingRecords: 1,
  },
};

describe('ImportReviewPanel', () => {
  it('用直白说明展示异常，阻止保留无法识别的记录', () => {
    const onReviewDecision = vi.fn();
    const onConfirmImport = vi.fn();
    const onCancel = vi.fn();

    render(
      <ImportReviewPanel
        status={ImportStatus.REVIEW_REQUIRED}
        importSummary={importSummary}
        reviewRecords={reviewRecords}
        reviewDecisions={{ 0: 'skip', 1: 'keep' }}
        onReviewDecision={onReviewDecision}
        onConfirmImport={onConfirmImport}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('导入尚未写入，请先确认')).toBeInTheDocument();
    expect(screen.getByText('这条记录缺少物品名称，无法安全识别。')).toBeInTheDocument();
    expect(screen.getByText('物品名称缺失')).toBeInTheDocument();

    const keepButtons = screen.getAllByRole('button', { name: '保留' });
    expect(keepButtons[0]).toBeDisabled();
    expect(keepButtons[1]).toBeEnabled();
    fireEvent.click(keepButtons[1]);
    expect(onReviewDecision).toHaveBeenCalledWith(1, 'keep');

    fireEvent.click(screen.getAllByRole('button', { name: '跳过' })[1]);
    expect(onReviewDecision).toHaveBeenCalledWith(1, 'skip');
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('异常记录被错误标为保留时禁止确认', () => {
    render(
      <ImportReviewPanel
        status={ImportStatus.REVIEW_REQUIRED}
        importSummary={importSummary}
        reviewRecords={reviewRecords}
        reviewDecisions={{ 0: 'keep', 1: 'keep' }}
        onReviewDecision={vi.fn()}
        onConfirmImport={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('仍有无法识别的记录被选为保留，请先改为跳过。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认/ })).toBeDisabled();
  });

  it('确认写入期间锁定所有操作', () => {
    render(
      <ImportReviewPanel
        status={ImportStatus.CONFIRMING}
        importSummary={importSummary}
        reviewRecords={reviewRecords}
        reviewDecisions={{ 0: 'skip', 1: 'keep' }}
        onReviewDecision={vi.fn()}
        onConfirmImport={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    screen.getAllByRole('button').forEach((button) => {
      expect(button).toBeDisabled();
    });
  });
});
