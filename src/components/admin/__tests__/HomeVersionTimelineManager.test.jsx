import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomeVersionTimelineManager from '../HomeVersionTimelineManager.jsx';
import { loadAdminSiteConfigItems } from '../../../services/admin/siteConfigService.js';
import useSiteConfigStore from '../../../stores/useSiteConfigStore.js';

vi.mock('../../../services/admin/siteConfigService.js', () => ({
  loadAdminSiteConfigItems: vi.fn(),
}));

const updateConfigMock = vi.fn();

vi.mock('../../../stores/useSiteConfigStore.js', () => {
  const store = vi.fn();
  store.getState = vi.fn(() => ({
    updateConfig: updateConfigMock,
    updateError: null,
  }));

  return {
    default: store,
    DEFAULT_HOME_NEXT_VERSION_TARGET_DATE: '2026-06-05T12:00:00+08:00',
    DEFAULT_HOME_VERSION_TIMELINE: [
      {
        id: 'lost-heirlooms',
        name: '寻遗散记',
        name_en: 'Lost Heirlooms',
        starts_at: '2026-06-05T12:00:00+08:00',
        ends_at: null,
        enabled: true,
        order: 10,
        pool_ids: [],
      },
    ],
    HOME_VERSION_TIMELINE_CONFIG_KEY: 'home_version_timeline',
  };
});

describe('HomeVersionTimelineManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateConfigMock.mockResolvedValue(true);
    useSiteConfigStore.getState.mockReturnValue({
      updateConfig: updateConfigMock,
      updateError: null,
    });
    loadAdminSiteConfigItems.mockResolvedValue([
      {
        key: 'home_version_timeline',
        value: JSON.stringify({
          versions: [
            {
              id: 'lost-heirlooms',
              name: '寻遗散记',
              name_en: 'Lost Heirlooms',
              starts_at: '2026-04-01T12:00:00+08:00',
              ends_at: null,
              enabled: true,
              order: 10,
              pool_ids: [],
            },
          ],
        }),
      },
    ]);
  });

  it('selects pools, previews folded extra pools, fills duration, and saves the timeline', async () => {
    const showToast = vi.fn();
    render(
      <HomeVersionTimelineManager
        showToast={showToast}
        pools={[
          {
            pool_id: 'extra_festival',
            name: '辉光庆典',
            type: 'extra',
            start_time: '2026-04-01T12:00:00+08:00',
            end_time: '2026-04-08T12:00:00+08:00',
          },
          {
            pool_id: 'limited_zhuang',
            name: '庄方宜',
            type: 'limited',
            start_time: '2026-04-09T12:00:00+08:00',
            end_time: '2026-04-22T12:00:00+08:00',
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('版本节点 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /辉光庆典/u }));
    fireEvent.click(screen.getByRole('button', { name: /庄方宜/u }));
    fireEvent.click(screen.getByRole('button', { name: '按已选卡池时间填入' }));

    await waitFor(() => {
      expect(screen.getByText(/1 个展示卡池，折叠 1 个过期附加池/u)).toBeInTheDocument();
      expect(screen.getByText('合并 1')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('21')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存版本时间线' }));

    await waitFor(() => {
      expect(updateConfigMock).toHaveBeenCalledTimes(1);
    });

    const [key, value, meta] = updateConfigMock.mock.calls[0];
    expect(key).toBe('home_version_timeline');
    expect(meta).toMatchObject({
      label: '首页版本时间线',
      category: 'content',
    });
    expect(JSON.parse(value)).toMatchObject({
      versions: [
        {
          id: 'lost-heirlooms',
          name: '寻遗散记',
          starts_at: '2026-04-01T12:00:00+08:00',
          ends_at: '2026-04-22T12:00:00+08:00',
          duration_days: 21,
          pool_ids: ['extra_festival', 'limited_zhuang'],
        },
      ],
    });
    expect(showToast).toHaveBeenCalledWith('版本时间线已保存', 'success');
  });

  it('labels and saves both reconstruction pools in version pool_ids', async () => {
    render(
      <HomeVersionTimelineManager
        pools={[
          {
            pool_id: 'extra_reconstruction_character',
            name: '重构寻访·伊冯',
            type: 'extra',
            up_character: '伊冯',
            extra_rule_profile: 'reconstruction_character_v1',
            start_time: '2026-04-01T12:00:00+08:00',
            end_time: null,
          },
          {
            pool_id: 'extra_reconstruction_weapon',
            name: '重构申领·艺术暴君',
            type: 'extra',
            up_character: '艺术暴君',
            extra_subtype: 'reconstruction_claim',
            extra_rule_profile: 'reconstruction_weapon_v1',
            start_time: '2026-04-01T12:00:00+08:00',
            end_time: null,
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('版本节点 1')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /extra_reconstruction_character · 重构寻访/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /extra_reconstruction_weapon · 重构申领/u })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重构寻访·伊冯/u }));
    fireEvent.click(screen.getByRole('button', { name: /重构申领·艺术暴君/u }));
    fireEvent.click(screen.getByRole('button', { name: '保存版本时间线' }));

    await waitFor(() => {
      expect(updateConfigMock).toHaveBeenCalledTimes(1);
    });

    const savedTimeline = JSON.parse(updateConfigMock.mock.calls[0][1]);
    expect(savedTimeline.versions[0].pool_ids).toEqual([
      'extra_reconstruction_character',
      'extra_reconstruction_weapon',
    ]);
  });
});
