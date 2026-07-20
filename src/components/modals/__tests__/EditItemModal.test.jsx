import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditItemModal from '../EditItemModal.jsx';
import { I18nProvider } from '../../../i18n/index.js';

const characterCacheMock = vi.hoisted(() => ({
  getAll: vi.fn(),
  load: vi.fn(),
  searchByName: vi.fn(),
}));

vi.mock('../../../utils/characterUtils.js', () => ({
  characterCache: characterCacheMock,
}));

const catalogItems = [
  {
    id: 'char-6',
    type: 'character',
    name: '角色六星',
    rarity: 6,
    aliases: ['测试角色'],
    avatar_url: '/avatars/characters/char-6.png',
  },
  { id: 'char-5', type: 'character', name: '角色五星', rarity: 5, aliases: [] },
  {
    id: 'weapon-6',
    type: 'weapon',
    name: '武器六星',
    rarity: 6,
    aliases: [],
    avatar_url: '/avatars/weapons/weapon-6.png',
  },
];

const pools = [
  { id: 'char-pool', name: '限定角色池', type: 'limited_character' },
  { id: 'weapon-pool', name: '限定武器池', type: 'limited_weapon' },
];

const baseItem = {
  record_id: 'record-1',
  timestamp: '2026-07-11T10:00:00.000Z',
  pool_id: 'char-pool',
  character_id: 'char-6',
  rarity: 6,
  is_standard: false,
  special_type: null,
};

function renderModal(overrides = {}, locale = 'zh-CN') {
  const props = {
    item: baseItem,
    pools,
    onClose: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn(),
    ...overrides,
  };
  const view = render(
    <I18nProvider initialLocale={locale}>
      <EditItemModal {...props} />
    </I18nProvider>
  );
  return { ...props, ...view };
}

describe('EditItemModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    characterCacheMock.getAll.mockReturnValue(catalogItems);
    characterCacheMock.load.mockReturnValue(new Promise(() => {}));
    characterCacheMock.searchByName.mockReturnValue(null);
  });

  it('保存时间、卡池、目录目标、情报书和六星标记', async () => {
    const props = renderModal();
    await screen.findByRole('heading', { name: '编辑详细日志' });

    fireEvent.click(screen.getByRole('button', { name: '情报书' }));
    fireEvent.click(screen.getByRole('button', { name: '常驻 / 歪' }));
    fireEvent.change(screen.getByLabelText('特殊标记'), { target: { value: 'guaranteed' } });
    fireEvent.change(screen.getByLabelText('修改说明（可选）'), { target: { value: '核对官方记录' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(props.onUpdate).toHaveBeenCalledWith(
        baseItem,
        {
          timestamp: new Date(baseItem.timestamp).toISOString(),
          poolId: 'char-pool',
          characterId: 'char-6',
          drawMethod: 'info_book',
          isStandard: true,
          specialType: 'guaranteed',
        },
        '核对官方记录'
      );
    });
  });

  it('切换角色与武器卡池时清除不匹配目标并过滤目录', async () => {
    renderModal();
    await screen.findByRole('heading', { name: '编辑详细日志' });

    expect(screen.getByRole('img', { name: '角色六星' })).toHaveAttribute('src', '/avatars/characters/char-6.png');
    expect(screen.queryByRole('button', { name: /选择武器六星/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '限定武器池' }));

    expect(screen.getByRole('radio', { name: '限定武器池' })).toBeChecked();
    expect(screen.queryByRole('button', { name: /选择角色六星/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择武器六星/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '武器六星' })).toHaveAttribute('src', '/avatars/weapons/weapon-6.png');
    expect(screen.getByPlaceholderText('搜索武器名称或 ID')).toBeInTheDocument();
  });

  it('选择非六星目标时强制清除 UP 和特殊标记', async () => {
    const item = { ...baseItem, is_standard: true, special_type: 'guaranteed' };
    const props = renderModal({ item });
    await screen.findByRole('heading', { name: '编辑详细日志' });

    fireEvent.click(screen.getByRole('button', { name: '选择角色五星（5星）' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(props.onUpdate).toHaveBeenCalledWith(
        item,
        expect.objectContaining({
          characterId: 'char-5',
          isStandard: false,
          specialType: null,
        }),
        ''
      );
    });
  });

  it('拒绝不存在的卡池和卡池类型不匹配的目录目标', async () => {
    const stalePoolProps = renderModal({
      item: { ...baseItem, pool_id: 'removed-pool' },
    });
    await screen.findByRole('heading', { name: '编辑详细日志' });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(screen.getByText('请选择这条记录所属的卡池。')).toBeInTheDocument();
    expect(stalePoolProps.onUpdate).not.toHaveBeenCalled();
    stalePoolProps.unmount();

    const wrongTypeProps = renderModal({
      item: { ...baseItem, character_id: 'weapon-6' },
    });
    await screen.findByRole('heading', { name: '编辑详细日志' });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(screen.getByText('请选择对应的角色。')).toBeInTheDocument();
    expect(wrongTypeProps.onUpdate).not.toHaveBeenCalled();
  });

  it('支持驼峰目录 ID，并将删除和关闭交给上层确认流程', async () => {
    const item = { ...baseItem, character_id: undefined, characterId: 'char-6' };
    const props = renderModal({ item });
    await screen.findByRole('heading', { name: '编辑详细日志' });

    expect(screen.getByRole('button', { name: '选择角色六星（6星）' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '删除异常记录' }));
    expect(props.onDelete).toHaveBeenCalledWith(item);
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑窗口' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('英文界面完整显示异常记录编辑动作', async () => {
    renderModal({}, 'en-US');

    expect(await screen.findByRole('heading', { name: 'Edit Detailed Record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Intel Book' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Abnormal Record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });
});
