import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImportAccountScopeNotice from '../components/ImportAccountScopeNotice.jsx';
import { getImportAccountScopeConflicts } from '../../../utils/importAccountScope.js';

const existing = [{ gameUid: 'same', serverId: '1' }];
vi.mock('../../../hooks/app/usePersonalGameAccounts.js', () => ({ usePersonalGameAccounts: () => [{ gameUid: 'same', serverId: '1' }] }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => ({ isEnglish: false }) }));
afterEach(cleanup);

it('explains the server split and links to settings without automatically merging', () => {
  render(<ImportAccountScopeNotice accounts={[{ gameUid: 'same', serverId: 'bilibili' }]} />);
  expect(screen.getByRole('note')).toHaveTextContent('旧记录不会因此被删除');
  expect(screen.getByRole('note')).toHaveTextContent('确认是同一个游戏账号后');
  expect(screen.getByRole('link')).toHaveAttribute('href', '/settings');
  expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
});

it('does not warn for the same server, other UIDs or international UID coincidences', () => {
  expect(getImportAccountScopeConflicts([{ gameUid: 'same', serverId: '1' }], existing)).toEqual([]);
  expect(getImportAccountScopeConflicts([{ gameUid: 'other', serverId: 'bilibili' }], existing)).toEqual([]);
  expect(getImportAccountScopeConflicts([{ gameUid: 'same', serverId: '2' }], existing)).toEqual([]);
});

it('uses the Bilibili channel when the official API still calls its region server 1', () => {
  expect(getImportAccountScopeConflicts([{ gameUid: 'same', serverId: '1', channelMasterId: '2' }], existing))
    .toEqual([{ gameUid: 'same', serverId: 'bilibili' }]);
});
