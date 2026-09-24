// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BatchCard from '../../BatchCard.jsx';

vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ locale: 'zh-CN' }) }));
vi.mock('../../../utils/characterUtils', () => ({ characterCache: { searchByName: () => null } }));
vi.mock('../../../utils/gameDataI18n.js', () => ({ localizeHistoryItemName: (record) => record.name }));

describe('记录期次展示', () => {
  it('在同一卡池记录中区分两期，折叠和展开均保留期次', () => {
    const group = [1, 2].map((version) => ({
      id: `record-${version}`, poolId: 'rerun-original', poolVersion: version,
      rarity: 4, name: '测试角色', timestamp: '2026-09-01T00:00:00Z', globalIndex: version,
    }));
    render(<BatchCard group={group} poolType="extra" showPoolName poolMetaById={new Map([
      ['rerun-original', { name: '重构寻访', type: 'extra' }],
    ])} />);
    expect(screen.getAllByText('重构寻访')).toHaveLength(1);
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    fireEvent.click(screen.getByText('No.1 - 2'));
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
  });
});
