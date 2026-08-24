import { useMemo } from 'react';
import {
  useHistoryStore,
  usePersonalAnalysisStore,
} from '../../stores/index.js';
import { resolveGameAccountServerTag } from '../../utils/gameAccountMetadata.js';

function addDisplayServerTags(accounts) {
  return (Array.isArray(accounts) ? accounts : []).map((account) => ({
    ...account,
    serverTag: resolveGameAccountServerTag(account) || '区服待确认',
  }));
}

/**
 * Return the authoritative account manifest when analysis is available.
 * Raw history remains a compatibility fallback for guests and pre-snapshot
 * flows; a partially loaded history page never replaces the manifest.
 */
export function usePersonalGameAccounts() {
  const history = useHistoryStore((state) => state.history);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);
  const analysisAvailability = usePersonalAnalysisStore((state) => state.availability);
  const analysisOwner = usePersonalAnalysisStore((state) => state.owner);

  return useMemo(() => {
    if (
      ['ready', 'stale', 'empty'].includes(analysisAvailability)
      && Array.isArray(analysisOwner?.accounts)
    ) {
      return addDisplayServerTags(analysisOwner.accounts);
    }

    void history;
    return addDisplayServerTags(getGameAccountsFromHistory());
  }, [analysisAvailability, analysisOwner, getGameAccountsFromHistory, history]);
}

export default usePersonalGameAccounts;
