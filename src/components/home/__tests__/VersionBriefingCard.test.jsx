import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VersionBriefingCard from '../VersionBriefingCard.jsx';
import { VERSION_8_BRIEFING, VERSION_BRIEFING_URL } from '../../../constants/versionPreview.js';

const state = vi.hoisted(() => ({
  app: { gameAnnouncements: [] },
  site: { config: { home_version_timeline: { versions: [
    { id: 'version-8', name: '穿越甚大蘑境与你相逢', starts_at: '2026-11-25T12:00:00+08:00' },
    { id: 'version-9', name: '罗德岛与白垩洲', starts_at: '2027-01-07T12:00:00+08:00' },
  ] } } },
}));

vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ isEnglish: false }) }));
vi.mock('../../../stores/index.js', () => ({ useAppStore: selector => selector(state.app) }));
vi.mock('../../../stores/useSiteConfigStore.js', () => ({ default: selector => selector(state.site) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.app.gameAnnouncements = [];
});

describe('homepage version briefing', () => {
  it('uses the published VERSION 8 cover and link before the announcement feed syncs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T00:01:00+08:00'));
    render(<VersionBriefingCard />);

    expect(screen.getByRole('img', { name: '「穿越甚大蘑境与你相逢」新版本导览' }))
      .toHaveAttribute('src', VERSION_8_BRIEFING.imageUrl);
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href', VERSION_8_BRIEFING.url);
    }
  });

  it('shows a newer matched official briefing when it is published', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-07T12:00:00+08:00'));
    state.app.gameAnnouncements = [{
      source_id: 'version-9-test', source_url: 'https://endfield.hypergryph.com/news/version-9-test',
      title: '「罗德岛与白垩洲」新版本导览', published_at: '2027-01-07T00:00:00Z',
      content: '![新版本导览封面](/version-9-cover.png)',
    }];
    render(<VersionBriefingCard />);

    expect(screen.getByRole('img', { name: '「罗德岛与白垩洲」新版本导览' }))
      .toHaveAttribute('src', '/version-9-cover.png');
    expect(screen.getByRole('link', { name: /查看导览/u })).toHaveAttribute('href', VERSION_BRIEFING_URL);
  });
});
