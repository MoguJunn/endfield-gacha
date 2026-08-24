import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopDashboardWorkspace from '../DesktopDashboardWorkspace.jsx';
import {
  useHistoryStore,
  usePersonalAnalysisStore,
  usePoolStore,
} from '../../../stores/index.js';
import { createPersonalAnalysisInitialState } from '../../../stores/usePersonalAnalysisStore.js';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
}));

vi.mock('../../modals/EditItemModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../../modals/DataExportOptionsModal.jsx', () => ({
  default: ({ gameAccounts }) => (
    <div data-testid="export-game-accounts">{JSON.stringify(gameAccounts)}</div>
  ),
}));

vi.mock('../../pool/PoolSelector.jsx', () => ({
  default: () => null,
}));

vi.mock('../PersonalDataBoundary.jsx', () => ({
  default: ({ children }) => children,
}));

vi.mock('../AccountServerLabelNotice.jsx', () => ({
  default: () => null,
}));

vi.mock('../../dashboard/DashboardView.jsx', () => ({
  default: () => null,
}));

vi.mock('../../records/RecordsView.jsx', () => ({
  default: () => null,
}));

vi.mock('../../../i18n/index.js', () => ({
  isEnglishLocale: (locale) => locale === 'en-US',
  useI18n: () => ({
    isEnglish: false,
    locale: 'zh-CN',
    t: (key) => key,
  }),
}));

function renderWorkspace() {
  return render(<DesktopDashboardWorkspace
    user={{ id: 'user-1' }}
    showToast={vi.fn()}
    onRetryPersonalData={vi.fn()}
    canEdit={false}
    canEditCurrentPool={false}
    currentPool={{ id: 'pool-1', name: 'Pool 1' }}
    editItemState={null}
    setEditItemState={vi.fn()}
    handleUpdateItem={vi.fn()}
    handleDeleteItem={vi.fn()}
    handleDeleteGroup={vi.fn()}
    openImportWizard={vi.fn()}
  />);
}

describe('DesktopDashboardWorkspace export accounts', () => {
  beforeEach(() => {
    usePoolStore.setState({
      pools: [{ id: 'pool-1', name: 'Pool 1' }],
      currentPoolId: 'pool-1',
      currentGameUid: 'game-1::server:1',
    });
    usePersonalAnalysisStore.setState(createPersonalAnalysisInitialState());
  });

  it('passes analysis snapshot accounts to export UI instead of partial history accounts', async () => {
    const snapshotAccounts = [{
      accountKey: 'game-1::server:1',
      gameUid: 'game-1',
      serverScope: '1',
      region: 'cn',
    }];
    const historyAccounts = [{
      accountKey: 'partial-game::server:2',
      gameUid: 'partial-game',
    }];
    useHistoryStore.setState({
      getGameAccountsFromHistory: vi.fn(() => historyAccounts),
    });
    usePersonalAnalysisStore.setState({
      ownerId: 'user-1',
      availability: 'ready',
      owner: { accounts: snapshotAccounts },
    });

    await act(async () => {
      renderWorkspace();
    });

    expect(JSON.parse(screen.getByTestId('export-game-accounts').textContent)).toEqual([{
      ...snapshotAccounts[0],
      serverTag: '官服',
    }]);
  });

  it('passes history-derived accounts when no analysis snapshot accounts exist', async () => {
    const historyAccounts = [{ accountKey: 'legacy-game', gameUid: 'legacy-game' }];
    useHistoryStore.setState({
      getGameAccountsFromHistory: vi.fn(() => historyAccounts),
    });

    await act(async () => {
      renderWorkspace();
    });

    expect(JSON.parse(screen.getByTestId('export-game-accounts').textContent)).toEqual([{
      ...historyAccounts[0],
      serverTag: '区服待确认',
    }]);
  });
});
