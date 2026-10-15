import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PoolCard from '../pools/PoolCard.jsx';

const props = { pool: { pool_id: 'zero-history', name: '零记录池', type: 'limited' },
  characters: [], poolCharacters: {}, onEdit: vi.fn(), onDelete: vi.fn() };

describe('admin roster presentation', () => {
  it.each([
    { rosterLoading: true, text: '正在读取卡池名单…' },
    { rosterError: 'offline', text: '卡池名单读取失败，请重试' },
  ])('does not label unavailable data as unconfigured: $text', ({ text, ...state }) => {
    render(<PoolCard {...props} {...state} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/暂无角色配置/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
  });

  it('shows the configured roster without requiring any history', () => {
    render(<PoolCard {...props} characters={[{ id: 'entity', name: '角色甲', rarity: 6 }]}
      poolCharacters={{ 'zero-history': [{ character_id: 'entity', is_up: false }] }} />);
    expect(screen.getByText('角色甲')).toBeInTheDocument();
    expect(screen.queryByText(/暂无角色配置/)).not.toBeInTheDocument();
  });

  it('uses the empty message only after a successful empty read', () => {
    render(<PoolCard {...props} />);
    expect(screen.getByText(/暂无角色配置/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).not.toBeDisabled();
  });
});
