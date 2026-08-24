import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePersonalAnalysisStore from '../../../stores/usePersonalAnalysisStore.js';
import AccountServerLabelNotice from '../AccountServerLabelNotice.jsx';

const harness = vi.hoisted(() => ({
  accounts: [],
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => harness.navigate,
}));

vi.mock('../../../hooks/app/usePersonalGameAccounts.js', () => ({
  usePersonalGameAccounts: () => harness.accounts,
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    t: (key) => key,
  }),
}));

describe('AccountServerLabelNotice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.navigate.mockReset();
    harness.accounts = [{
      gameUid: '1001',
      accountKey: '1001::server:1',
      serverId: '1',
      serverScope: 'legacy',
    }];
    usePersonalAnalysisStore.getState().clearAnalysis('test_reset');
    usePersonalAnalysisStore.getState().applyAnalysis('owner-a', {
      availability: 'ready',
      owner: { accounts: harness.accounts },
      scope: null,
      meta: { ownerId: 'owner-a' },
    });
  });

  it('navigates to desktop settings with the server-label anchor', () => {
    render(<AccountServerLabelNotice ownerId="owner-a" />);
    fireEvent.click(screen.getByText('dashboard.serverNotice.action'));

    expect(harness.navigate).toHaveBeenCalledWith('/settings', {
      state: expect.objectContaining({ scrollTo: 'settings-account-server-labels' }),
    });
  });

  it('supports temporary dismissal and owner-scoped permanent ignore', () => {
    const { rerender } = render(<AccountServerLabelNotice ownerId="owner-a" />);
    fireEvent.click(screen.getByLabelText('dashboard.serverNotice.dismiss'));
    expect(screen.queryByText('dashboard.serverNotice.title')).not.toBeInTheDocument();

    rerender(<AccountServerLabelNotice ownerId="owner-b" />);
    act(() => {
      usePersonalAnalysisStore.getState().applyAnalysis('owner-b', {
        availability: 'ready',
        owner: { accounts: harness.accounts },
        scope: null,
        meta: { ownerId: 'owner-b' },
      });
    });
    rerender(<AccountServerLabelNotice ownerId="owner-b" />);
    expect(screen.getByText('dashboard.serverNotice.title')).toBeInTheDocument();
    fireEvent.click(screen.getByText('dashboard.serverNotice.ignore'));
    expect(screen.queryByText('dashboard.serverNotice.title')).not.toBeInTheDocument();
  });
});
