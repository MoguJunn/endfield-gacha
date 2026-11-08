import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunityActivitySection from '../CommunityActivitySection.jsx';

vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ isEnglish: false }) }));
vi.mock('../CommunityActivityPanel.jsx', () => ({ default: () => <div>社区内容</div> }));
vi.mock('../VersionBriefingCard.jsx', () => ({ default: () => <div>新版本导览</div> }));

describe('community special program and briefing lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps the original countdown before broadcast and switches after the program while mounted', () => {
    vi.setSystemTime(new Date('2026-10-06T19:29:59+08:00'));
    render(<CommunityActivitySection />);
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.queryByText('新版本导览')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('已到播出时间')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(90 * 60 * 1000); });
    expect(screen.getByText('新版本导览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第2页：导览' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '第1页：社区' }));
    expect(screen.getByText('社区内容')).toBeInTheDocument();
  });

  it('keeps briefing after version release and hides it during the next announced program window', () => {
    vi.setSystemTime(new Date('2026-11-01T00:00:00+08:00'));
    const preview = { announcedAt: '2026-11-01T00:00:02+08:00', endsAt: '2026-11-01T00:00:04+08:00' };
    render(<CommunityActivitySection preview={preview} />);
    expect(screen.getByText('新版本导览')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: '第2页：前瞻' })).toBeInTheDocument();
    expect(screen.queryByText('新版本导览')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('新版本导览')).toBeInTheDocument();
  });

  it('defaults to the current giveaway and lets visitors switch to community and briefing', () => {
    vi.setSystemTime(new Date('2026-11-08T14:00:00+08:00'));
    render(<CommunityActivitySection />);
    expect(screen.getByRole('button', { name: '第1页：抽奖' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: '参与卫戍协议规程特别抽奖' })).toHaveAttribute('href', '/lottery');
    expect(screen.getByText('全能开发者主题包')).toBeInTheDocument();
    expect(screen.getByText('Neptune')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '第2页：社区' }));
    expect(screen.getByText('社区内容')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '第3页：导览' }));
    expect(screen.getByText('新版本导览')).toBeInTheDocument();
  });

  it('stops promoting participation when the giveaway deadline passes', () => {
    vi.setSystemTime(new Date('2026-11-21T23:59:59+08:00'));
    render(<CommunityActivitySection />);
    expect(screen.getByRole('link', { name: '参与卫戍协议规程特别抽奖' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('button', { name: '第1页：抽奖' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '参与卫戍协议规程特别抽奖' })).not.toBeInTheDocument();
    expect(screen.getByText('新版本导览')).toBeInTheDocument();
  });
});
