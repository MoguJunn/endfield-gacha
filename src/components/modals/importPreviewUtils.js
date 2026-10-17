export function normalizeImportPreviewText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function getImportRecordName(record) {
  return normalizeImportPreviewText(
    record?.name
      || record?.item_name
      || record?.itemName
      || record?.character_name
      || record?.characterName
  );
}

function getImportRecordTimestampMs(record) {
  const timestamp = normalizeImportPreviewText(record?.timestamp || record?.created_at || record?.createdAt);
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function getImportAccountKey(account, { allowNameFallback = false } = {}) {
  const gameUid = normalizeImportPreviewText(account?.gameUid || account?.game_uid || account?.uid || account?.hgUid);
  const nickName = normalizeImportPreviewText(
    account?.nickName
    || account?.nick_name
    || account?.nickname
    || (allowNameFallback ? account?.name : null)
  );
  if (!gameUid && !nickName) {
    return null;
  }
  return gameUid || `nick:${nickName}`;
}

function collectImportAccounts(data) {
  const accounts = new Map();
  const addAccount = (account, options = {}) => {
    const key = getImportAccountKey(account, options);
    if (!key) {
      return;
    }

    const current = accounts.get(key) || {};
    accounts.set(key, {
      gameUid: current.gameUid || normalizeImportPreviewText(account?.gameUid || account?.game_uid || account?.uid || account?.hgUid),
      nickName: current.nickName || normalizeImportPreviewText(
        account?.nickName
        || account?.nick_name
        || account?.nickname
        || (options.allowNameFallback ? account?.name : null)
      ),
      channelName: current.channelName || normalizeImportPreviewText(account?.channelName || account?.channel_name),
      serverId: current.serverId || normalizeImportPreviewText(account?.serverId || account?.server_id),
    });
  };

  (Array.isArray(data?.accounts) ? data.accounts : []).forEach((account) => {
    addAccount(account, { allowNameFallback: true });
  });
  (Array.isArray(data?.history) ? data.history : []).forEach((record) => {
    addAccount(record);
  });

  return Array.from(accounts.values());
}

function getPoolPreviewName(pool) {
  if (!pool) {
    return '';
  }
  return normalizeImportPreviewText(pool?.name || pool?.up_character || pool?.id);
}

export function buildPendingImportPreview(pendingImport) {
  if (!pendingImport?.data) {
    return {
      historyCount: 0,
      poolCount: 0,
      rarityCounts: {},
      sixStarDrops: [],
      poolBreakdown: [],
      accounts: [],
      accountCount: 0,
      primaryAccount: null,
      sourceLabel: '',
      accountInfoMissing: false,
      startMs: null,
      endMs: null
    };
  }

  const data = pendingImport.data;
  const history = Array.isArray(data.history) ? data.history : [];
  const supplements = data.workbenchEntries || [];
  const pools = Array.isArray(data.pools) ? data.pools : [];
  const poolLookup = new Map(pools.map(pool => [pool?.id, pool]));
  const rarityCounts = {};
  const sixStarMap = new Map();
  const poolCounts = new Map();
  let startMs = null;
  let endMs = null;

  const supplementalDrops = supplements.flatMap(entry => (entry.values?.acquisitions || []).map(row => ({ ...row,
    poolId: entry.poolId, name: row.name || row.entityName || row.entityId })));
  [...history, ...supplementalDrops].forEach((record) => {
    const rarity = Number(record?.rarity);
    if (Number.isInteger(rarity)) {
      rarityCounts[rarity] = (rarityCounts[rarity] || 0) + 1;
    }

    if (rarity === 6) {
      const name = getImportRecordName(record);
      if (name) {
        sixStarMap.set(name, (sixStarMap.get(name) || 0) + 1);
      }
    }

    const poolId = record?.poolId || record?.pool_id;
    const pool = poolLookup.get(poolId);
    const poolName = getPoolPreviewName(pool) || normalizeImportPreviewText(poolId);
    if (poolName) {
      poolCounts.set(poolName, (poolCounts.get(poolName) || 0) + 1);
    }

    const timestampMs = getImportRecordTimestampMs(record);
    if (timestampMs !== null) {
      startMs = startMs === null ? timestampMs : Math.min(startMs, timestampMs);
      endMs = endMs === null ? timestampMs : Math.max(endMs, timestampMs);
    }
  });

  const accounts = collectImportAccounts(data);
  const accountInfoMissing = data.accountInfoMissing === true
    || (Array.isArray(data.importWarningCodes) && data.importWarningCodes.includes('missing_account_info'));

  return {
    historyCount: history.length,
    supplementCount: supplements.length,
    supplementalDropCount: supplementalDrops.length,
    unresolvedCount: data.unresolvedRecords?.length || 0,
    calendarConflictCount: data.calendarConflictCount || 0,
    intervalConflictCount: data.intervalConflictCount || 0,
    sparseSummary: data.importWarningCodes?.includes('sparse_high_star_summary') === true,
    accountServerMissing: data.accountServerMissing === true,
    poolCount: pools.length,
    rarityCounts,
    sixStarDrops: Array.from(sixStarMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 12),
    poolBreakdown: Array.from(poolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6),
    accounts,
    accountCount: accounts.length,
    primaryAccount: accounts[0] || null,
    sourceLabel: data.sourceFormatLabel || data.sourceFormatId || '',
    accountInfoMissing,
    startMs,
    endMs
  };
}
