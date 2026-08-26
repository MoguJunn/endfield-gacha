// @vitest-environment jsdom
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonalDataBoundary from '../PersonalDataBoundary.jsx';
import usePersonalAnalysisStore, {
  createPersonalAnalysisInitialState,
} from '../../../stores/usePersonalAnalysisStore.js';
import usePersonalDataStore, { createPersonalDataInitialState } from '../../../stores/usePersonalDataStore.js';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ isEnglish: false }),
}));

describe('PersonalDataBoundary', () => {
  beforeEach(() => {
    usePersonalDataStore.setState(createPersonalDataInitialState());
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not expose empty analysis while the authenticated owner is loading', () => {
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'loading',
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }}>
        <div>0 抽 暂无卡池数据</div>
      </PersonalDataBoundary>
    );

    expect(screen.queryByText('0 抽 暂无卡池数据')).toBeNull();
    expect(screen.getByTestId('personal-data-loading')).toBeTruthy();
  });

  it('renders a verified empty snapshot through the page instead of treating it as loading', () => {
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'empty',
      hasSnapshot: true,
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }}>
        <div>verified empty state</div>
      </PersonalDataBoundary>
    );

    expect(screen.getByText('verified empty state')).toBeTruthy();
  });

  it('keeps the last successful snapshot visible when a refresh fails', () => {
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'ready',
      hasSnapshot: true,
      error: new Error('refresh failed'),
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }}>
        <div>existing analysis</div>
      </PersonalDataBoundary>
    );

    expect(screen.getByText('existing analysis')).toBeTruthy();
    expect(screen.getByTestId('personal-data-stale-error')).toBeTruthy();
  });

  it('shows a safe actionable reason and diagnostic code for an initial read failure', () => {
    const error = new Error('server detail must not be rendered directly');
    error.code = 'auth_identity_conflict';
    error.status = 409;
    error.requestId = 'request-123';
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'error',
      error,
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }} onRetry={vi.fn()}>
        <div>empty data must stay hidden</div>
      </PersonalDataBoundary>
    );

    expect(screen.queryByText('empty data must stay hidden')).toBeNull();
    expect(screen.getByText('检测到两个不同账号的登录凭据。请退出登录后重新登录，再重试读取。')).toBeTruthy();
    expect(screen.getByTestId('personal-data-error-diagnostic').textContent).toBe(
      'HTTP 409 · code: auth_identity_conflict · request: request-123'
    );
    expect(screen.queryByText('server detail must not be rendered directly')).toBeNull();
  });

  it('building 阶段使用递增退避且达到上限后停止自动重试', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'building',
      hasSnapshot: false,
    });
    usePersonalAnalysisStore.setState({
      ...createPersonalAnalysisInitialState(),
      ownerId: 'user-1',
      availability: 'building',
      meta: { ownerId: 'user-1', retryAfterSeconds: 3 },
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }} onRetry={onRetry}>
        <div>0 抽 暂无卡池数据</div>
      </PersonalDataBoundary>
    );

    expect(screen.queryByText('0 抽 暂无卡池数据')).toBeNull();
    expect(screen.getByTestId('personal-data-building')).toBeTruthy();

    act(() => vi.advanceTimersByTime(2_999));
    expect(onRetry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRetry).toHaveBeenNthCalledWith(1, { automatic: true, phase: 'building' });

    act(() => vi.advanceTimersByTime(5_000));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => vi.advanceTimersByTime(20_000));
    act(() => vi.advanceTimersByTime(30_000));
    expect(onRetry).toHaveBeenCalledTimes(5);
    expect(screen.getByText('统计快照仍在后台排队，无需停留在本页面，可稍后手动重试。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '立即重试' })).toBeTruthy();

    act(() => vi.advanceTimersByTime(600_000));
    expect(onRetry).toHaveBeenCalledTimes(5);
  });

  it('组件重挂载后沿用全局重试截止时间而不是从头计时', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 7,
      phase: 'building',
      hasSnapshot: false,
    });
    usePersonalAnalysisStore.setState({
      ...createPersonalAnalysisInitialState(),
      ownerId: 'user-1',
      availability: 'building',
      meta: { ownerId: 'user-1', revision: '42', retryAfterSeconds: 30 },
    });

    const first = render(
      <PersonalDataBoundary user={{ id: 'user-1' }} onRetry={onRetry}>
        <div>hidden</div>
      </PersonalDataBoundary>
    );
    act(() => vi.advanceTimersByTime(10_000));
    first.unmount();

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }} onRetry={onRetry}>
        <div>hidden</div>
      </PersonalDataBoundary>
    );
    act(() => vi.advanceTimersByTime(19_999));
    expect(onRetry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('analysis stale 且无错误时显示非阻断提示', () => {
    usePersonalDataStore.setState({
      ...createPersonalDataInitialState(),
      ownerId: 'user-1',
      ownerGeneration: 1,
      phase: 'ready',
      hasSnapshot: true,
    });
    usePersonalAnalysisStore.setState({
      ...createPersonalAnalysisInitialState(),
      ownerId: 'user-1',
      availability: 'stale',
    });

    render(
      <PersonalDataBoundary user={{ id: 'user-1' }}>
        <div>existing analysis</div>
      </PersonalDataBoundary>
    );

    expect(screen.getByText('existing analysis')).toBeTruthy();
    expect(screen.getByTestId('personal-data-analysis-stale').textContent).toContain(
      '统计正在更新，当前显示上次结果'
    );
  });
});
