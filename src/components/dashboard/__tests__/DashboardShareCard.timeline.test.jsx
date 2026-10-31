import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DashboardShareCard from '../DashboardShareCard.jsx';
import { buildDashboardSharePayload } from '../../../utils/dashboardShare.js';
import { prepareTimelineSections } from '../../../utils/timelinePresentation.js';

vi.mock('../../share/ShareBrandPanel', () => ({ default: () => <span>Brand</span> }));
vi.mock('../../../i18n/index.js', async importOriginal => ({
  ...await importOriginal(),
  useI18n: () => ({ locale: 'zh-CN', isEnglish: false, t: (_key, _params, fallback) => fallback }),
}));

const section = (id, startTime) => ({ id, title: id, type: 'weapon', startTime,
  endTime: '2001-01-01T00:00:00Z', currentPity: 7, totalPulls: 20,
  entries: [{ id: `${id}-current`, isCurrentStage: true, pulls: 7, dropBadges: [], resultSummary: '旧的进行中' }],
  acquisitions: [
    { id: 'six', name: '六星武器', rarity: 6, timestamp: '2000-06-01T10:20:30Z', intervalPulls: 12, pullIndex: 12, stageKind: 'up' },
    { id: 'gift', name: '赠送武器', rarity: 6, timestamp: null, intervalPulls: null, pullIndex: null, drawMethod: 'gift' },
    { id: 'five', name: '五星武器', rarity: 5, timestamp: null, intervalPulls: null, pullIndex: null },
  ],
});
const sections = [section('old', '2000-01-01T00:00:00Z'), section('new', '2000-02-01T00:00:00Z')];

describe('dashboard share timeline parity', () => {
  it('uses banner order, selected banners and closed weapon remainder in the exported view', () => {
    const payload = buildDashboardSharePayload({ sections, timelinePresentation: { order: 'desc' } }, 'zh-CN');
    const prepared = prepareTimelineSections(sections);
    expect(prepared.map(row => row.id)).toEqual(['new', 'old']);
    expect(prepared[0].entries[0]).toMatchObject({ isCurrentStage: false, isClosedStage: true, stageLabel: '收池结余' });
    const selected = buildDashboardSharePayload({ sections, timelinePresentation: { order: 'asc', selectedIds: ['old'] } }, 'zh-CN');
    expect(selected.totalSections).toBe(1);
    const selectedSections = prepareTimelineSections(sections, [], { order: 'asc', selectedIds: ['old'] });
    expect(selectedSections.map(row => row.id)).toEqual(['old']);
    expect(JSON.stringify(selected)).not.toBe(JSON.stringify(payload));
    expect(payload).not.toHaveProperty('timelineSections');
    const html = renderToStaticMarkup(<DashboardShareCard payload={selected} sections={selectedSections} />);
    expect(html).toContain('收池结余');
    expect(html).not.toContain('旧的进行中');
  });

  it('exports individual acquisition cards and respects the five-star filter', () => {
    const payload = buildDashboardSharePayload({ sections: [sections[0]], timelineDisplayMode: 'card', showFiveStarDrops: false }, 'zh-CN');
    expect(payload.totalNodes).toBe(2);
    const html = renderToStaticMarkup(<DashboardShareCard payload={payload} sections={prepareTimelineSections([sections[0]])} displayMode="card" showFiveStarDrops={false} theme="dark" />);
    expect(html).toContain('各池出货明细');
    expect(html).toContain('六星武器');
    expect(html).toContain('第 12 抽');
    expect(html).toContain('额外赠送');
    expect(html).toContain('时间未知');
    expect(html).not.toContain('五星武器');
    expect(html).not.toContain('收池结余');
    expect(payload.notes).toContain('包含出货结果与获取时间');
  });
  it('keeps guarantee, inherited pity and complete weapon batch details in waterfall images', () => {
    const entries = [{ id: 'guaranteed', stageKind: 'up', guaranteePulls: 120, pulls: 60, targetPulls: 80,
      inheritedPulls: 20, localPulls: 40, stageLabel: 'UP', dropBadges: [],
      weaponBatch: { isCompleteTenPull: true, size: 10, sixStarCount: 2, fiveStarCount: 1,
        slots: Array.from({ length: 10 }, (_, index) => ({ rarity: index < 2 ? 6 : 4, label: '武器' })) } },
    { id: 'unknown', unknownInheritedPity: true, pulls: null, localPulls: 12, dropBadges: [] }];
    const payload = buildDashboardSharePayload({ sections: [{ ...sections[0], entries }] }, 'zh-CN');
    const html = renderToStaticMarkup(<DashboardShareCard payload={payload} sections={prepareTimelineSections([{ ...sections[0], entries }])} />);
    expect(html).toContain('120 抽保底出货');
    expect(html).toContain('上池垫抽 20 抽 + 本池 40 抽');
    expect(html).toContain('本次十连');
    expect(html).toContain('6★ ×2');
    expect(html).toContain('继承未知');
  });
});
