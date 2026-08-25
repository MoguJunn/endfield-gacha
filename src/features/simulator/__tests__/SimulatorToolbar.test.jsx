import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SimulatorToolbar from '../SimulatorToolbar.jsx';

vi.mock('../../../stores', () => ({
  useHistoryStore: (selector) => selector({
    history: [],
    getGameAccountsFromHistory: () => [],
  }),
  usePersonalAnalysisStore: (selector) => selector({
    availability: 'idle',
    owner: null,
  }),
}));

vi.mock('../../../i18n/index.js', () => ({
  getAppLocale: () => 'zh-CN',
  getMessage: (key) => ({
    'pool.group.extra': '附加寻访',
    'pool.group.extraReconstruction': '重构寻访 / 申领',
    'pool.group.extraSpecial': '特殊寻访',
    'pool.group.extraUnclassified': '未分类附加寻访',
  })[key] || key,
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key, _params, fallback) => fallback || key,
  }),
}));

vi.mock('../../../utils/gameDataI18n.js', () => ({
  localizeEntityName: (name) => name,
  localizePoolFeaturedList: (pool) => pool.featured_characters || [pool.up_character].filter(Boolean),
  localizePoolName: (pool) => pool.name,
}));

vi.mock('../../../components/share/ShareActionStatus.jsx', () => ({
  default: () => null,
}));

vi.mock('../../../components/pool/PoolGroupCardRail.jsx', () => ({
  default: ({ groups, onSelectPool, onToggleSubgroup }) => (
    <div>
      {groups.flatMap((group) => group.subgroups || []).map((subgroup) => (
        <section key={subgroup.groupId}>
          <button
            type="button"
            onClick={() => onToggleSubgroup(subgroup.groupId, subgroup.isExpanded)}
          >
            {`切换${subgroup.label}`}
          </button>
          {subgroup.isExpanded ? subgroup.pools.map((pool) => (
            <button
              key={pool.id}
              type="button"
              title={`${pool.extra_rule_profile}:${pool.source_pool_id}`}
              onClick={() => onSelectPool(pool.id)}
            >
              {pool.name}
            </button>
          )) : null}
        </section>
      ))}
    </div>
  ),
}));

const reconstructionPools = [
  {
    id: 'sim_reconstruction_character',
    source_pool_id: 'reconstruction_character',
    type: 'extra',
    name: '重构寻访·伊冯 [模拟]',
    up_character: '伊冯',
    extra_subtype: 'reconstruction',
    extra_rule_profile: 'reconstruction_character_v1',
    extra_series_key: 'reconstruction-1',
    start_time: '2026-08-01T04:00:00.000Z',
    end_time: null,
  },
  {
    id: 'sim_reconstruction_weapon',
    source_pool_id: 'reconstruction_weapon',
    type: 'extra',
    name: '重构申领·艺术暴君 [模拟]',
    up_character: '艺术暴君',
    extra_subtype: 'reconstruction',
    extra_rule_profile: 'reconstruction_weapon_v1',
    extra_series_key: 'reconstruction-1',
    start_time: '2026-08-01T04:00:00.000Z',
    end_time: null,
  },
];

function renderToolbar(overrides = {}) {
  const onSwitchPool = vi.fn();
  render(
    <SimulatorToolbar
      currentSimPoolId="sim_reconstruction_character"
      onAdjustResourceAmount={vi.fn()}
      onCopyImage={vi.fn()}
      onDownloadImage={vi.fn()}
      onExportData={vi.fn()}
      onExportReport={vi.fn()}
      onInheritRealState={vi.fn()}
      onReset={vi.fn()}
      onShareImage={vi.fn()}
      onShareText={vi.fn()}
      onSwitchPool={onSwitchPool}
      onToggleCnOriginiteDoubleBonus={vi.fn()}
      onToggleInfiniteResources={vi.fn()}
      onToggleSkipAnimation={vi.fn()}
      originiteToJadeRate={75}
      poolPullCounts={{}}
      resourceLedger={{}}
      resourceSettings={{}}
      shareActionBusy={false}
      shareActionFeedback={null}
      simulatorPools={[
        ...reconstructionPools,
        {
          id: 'sim_festival',
          source_pool_id: 'festival',
          type: 'extra',
          name: '辉光庆典 [模拟]',
          featured_characters: ['莱万汀', '艾尔黛拉', '别礼', '洁尔佩塔'],
          extra_subtype: 'special',
          extra_rule_profile: 'brilliance_festival_v1',
          start_time: '2026-07-01T04:00:00.000Z',
          end_time: '2026-07-15T04:00:00.000Z',
        },
      ]}
      skipAnimation={false}
      supportsClipboardImageCopy={false}
      supportsImageShare={false}
      {...overrides}
    />
  );
  return { onSwitchPool };
}

describe('SimulatorToolbar extra pool subgroups', () => {
  it('expands reconstruction by default and selects both reconstruction pools', () => {
    const { onSwitchPool } = renderToolbar();

    expect(screen.getByRole('button', { name: '重构寻访·伊冯 [模拟]' })).toHaveAttribute(
      'title',
      'reconstruction_character_v1:reconstruction_character'
    );
    expect(screen.getByRole('button', { name: '重构申领·艺术暴君 [模拟]' })).toHaveAttribute(
      'title',
      'reconstruction_weapon_v1:reconstruction_weapon'
    );
    expect(screen.queryByRole('button', { name: '辉光庆典 [模拟]' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重构寻访·伊冯 [模拟]' }));
    fireEvent.click(screen.getByRole('button', { name: '重构申领·艺术暴君 [模拟]' }));

    expect(onSwitchPool).toHaveBeenNthCalledWith(1, 'sim_reconstruction_character');
    expect(onSwitchPool).toHaveBeenNthCalledWith(2, 'sim_reconstruction_weapon');
  });

  it('applies local subgroup expansion overrides while keeping the selected reconstruction visible', () => {
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: '切换重构寻访 / 申领' }));
    expect(screen.getByRole('button', { name: '重构寻访·伊冯 [模拟]' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换特殊寻访' }));
    expect(screen.getByRole('button', { name: '辉光庆典 [模拟]' })).toBeInTheDocument();
  });
});
