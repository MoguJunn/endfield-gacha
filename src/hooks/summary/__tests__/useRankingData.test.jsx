import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRankingData } from '../useRankingData.js';

const backend = vi.hoisted(() => ({ read: vi.fn(), versions: { public: { character_ranking: 'r1' } } }));
vi.mock('../../../services/statsService', () => ({ getCharacterRankingStats: backend.read, getUserRankingStats: vi.fn() }));
vi.mock('../../app/useSnapshotVersion.js', () => ({ useSnapshotVersion: () => backend.versions }));
afterEach(cleanup);

it('updates existing ranking rows when a new revision is published and rechecks after a refresh', async () => {
  backend.read.mockReset().mockResolvedValueOnce({ marker: 1 }).mockResolvedValueOnce({ marker: 2 }).mockResolvedValue({ marker: 3 });
  const view = renderHook(({ refresh }) => useRankingData('global', null, refresh), { initialProps: { refresh: 0 } });
  await waitFor(() => expect(view.result.current.characterRanking?.marker).toBe(1));
  backend.versions = { public: { character_ranking: 'r2' } };
  view.rerender({ refresh: 0 });
  await waitFor(() => expect(view.result.current.characterRanking?.marker).toBe(2));
  view.rerender({ refresh: 1 });
  await waitFor(() => expect(view.result.current.characterRanking?.marker).toBe(3));
  expect(backend.read).toHaveBeenCalledTimes(3);
});
