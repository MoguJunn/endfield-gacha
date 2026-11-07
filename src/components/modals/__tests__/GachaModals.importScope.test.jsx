import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GachaModals from '../GachaModals.jsx';

vi.mock('../../../AuthModal', () => ({ default: () => null }));
vi.mock('../../../hooks/app/usePersonalGameAccounts.js', () => ({ usePersonalGameAccounts: () => [{ gameUid: 'same', serverId: '1' }] }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ t: key => key, locale: 'zh-CN', isEnglish: false,
  formatNumber: String, formatDateTime: String }) }));

const base = { pools: [], history: [], accounts: [{ gameUid: 'same', nickName: '测试' }] };
function preview(data, confirmImport) {
  return render(<GachaModals knownDrawers={[]} toasts={[]} confirmState={{ isOpen: false }}
    pendingImport={{ data }} confirmImport={confirmImport} setPendingImport={vi.fn()} />);
}

describe('file import server confirmation', () => {
  it('keeps both server scopes and avoids overriding the entire backup with one verified account', async () => {
    const confirmImport = vi.fn();
    preview({ ...base, accounts: [{ ...base.accounts[0], serverId: '1' }, { ...base.accounts[0], serverId: 'bilibili' }] }, confirmImport);
    const button = screen.getByRole('button', { name: 'modals.import.confirm' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('官服')).toBeInTheDocument();
    expect(screen.getByText('B服')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: '导入区服提醒' })).toHaveTextContent('旧记录不会因此被删除');
    fireEvent.click(button);
    expect(confirmImport).toHaveBeenCalledWith({ accountOverride: null });
  });

  it('lets a manually confirmed Excel choose Bilibili explicitly and explains unnamed backup results', async () => {
    const confirmImport = vi.fn();
    preview({ ...base, sourceFormatId: 'endfield_helper_summary_xlsx', accountServerMissing: true,
      history: [{ gameUid: 'same', nickName: '测试', rarity: 4, timestamp: '2026-09-02T03:42:29.322Z' }] }, confirmImport);
    const select = screen.getByRole('combobox', { name: 'Excel 游戏区服' });
    await waitFor(() => expect(select).toHaveValue(''));
    fireEvent.change(select, { target: { value: 'bilibili' } });
    const button = screen.getByRole('button', { name: 'modals.import.confirm' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText(/本次导入区服：/)).toHaveTextContent('B服');
    expect(screen.getByText(/备份有 1 条记录缺少对象名称/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(confirmImport).toHaveBeenCalledWith({ accountOverride: { gameUid: 'same', nickName: '测试', serverId: 'bilibili' } });
  });
});
