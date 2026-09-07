import { isReservedPoolTypeId } from '../../shared/poolIdValidation.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function passthroughImportPayload(data) {
  return data;
}

function normalizeExternalText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function pickText(...values) {
  return values.map(normalizeExternalText).find(Boolean) || '';
}

function normalizeGameUidText(value) {
  const text = normalizeExternalText(value);
  const serverPrefixedMatch = text.match(/^\d+:(.+)$/);
  return serverPrefixedMatch ? serverPrefixedMatch[1] : text;
}

function normalizeExternalTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 10000000000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    const timestamp = numeric < 10000000000 ? numeric * 1000 : numeric;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeExternalBoolean(value) {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return false;
  }

  const normalized = normalizeExternalText(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'new', '是'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', '否', ''].includes(normalized)) {
    return false;
  }

  return false;
}

function inferPoolType({ poolId, category, poolType, poolGachaType } = {}) {
  const normalizedCategory = normalizeText(category).toLowerCase();
  const normalizedPoolType = normalizeText(poolType).toLowerCase();
  const normalizedGachaType = normalizeText(poolGachaType).toLowerCase();
  const prefix = normalizeText(poolId).split('_')[0]?.toLowerCase();

  if (
    normalizedCategory === 'weapon'
    || normalizedGachaType === 'weapon'
    || normalizedPoolType === 'weapon'
    || normalizedPoolType === 'limited_weapon'
    || prefix === 'weaponbox'
    || prefix === 'weponbox'
  ) {
    return 'weapon';
  }

  if (normalizedPoolType === 'standard' || normalizedPoolType === 'constant' || prefix === 'standard') {
    return 'standard';
  }

  if (normalizedPoolType === 'beginner' || prefix === 'beginner') {
    return 'beginner';
  }

  if (
    normalizedPoolType === 'extra'
    || normalizedPoolType === 'joint'
    || normalizedPoolType.includes('joint')
    || prefix === 'extra'
    || prefix === 'joint'
  ) {
    return 'extra';
  }

  return 'limited';
}

function upsertExternalPool(poolMap, seed = {}) {
  const explicitPoolId = pickText(seed.poolId, seed.pool_id);
  const legacyPoolValue = pickText(seed.pool);
  const poolId = explicitPoolId || legacyPoolValue;
  if (!poolId || isReservedPoolTypeId(poolId)) {
    return null;
  }

  const current = poolMap.get(poolId) || {};
  const next = {
    id: poolId,
    pool_id: poolId,
    name: pickText(seed.poolName, seed.pool_name, seed.name, current.name, poolId),
    type: inferPoolType({
      poolId,
      category: seed.category,
      poolType: seed.poolType || seed.pool_type || current.type,
      poolGachaType: seed.poolGachaType || seed.pool_gacha_type
    })
  };

  poolMap.set(poolId, {
    ...current,
    ...next
  });
  return poolId;
}

const ENDGACHA_KWER_POOL_NAME_TO_ID = Object.freeze({
  '启程寻访': 'beginner',
  '基础寻访': 'standard',
  '熔火灼痕': 'special_1_0_1',
  '热烈色彩': 'special_1_0_2',
  '轻飘飘的信使': 'special_1_0_3',
  '河流的女儿': 'special_1_1_1',
  '狼珀': 'special_1_1_2',
  '春雷动，万物生': 'special_1_2_1',
  '辉光庆典': 'joint_1_2_2',
  '熔铸申领': 'weponbox_1_0_1',
  '迅行申领': 'weponbox_1_0_3',
  '绯珀申领': 'weponbox_1_1_2',
  '行舟申领': 'weponbox_1_2_1',
  '星声申领': 'weaponbox_constant_2',
  '远途申领': 'weaponbox_constant_3',
  '崇山申领': 'weaponbox_constant_4'
});

function hashEndgachaPoolName(poolName) {
  const text = normalizeExternalText(poolName) || 'unknown';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function resolveEndgachaPoolId(poolName, explicitPoolId) {
  const poolId = pickText(explicitPoolId);
  if (poolId) {
    return poolId;
  }

  const normalizedPoolName = pickText(poolName);
  return ENDGACHA_KWER_POOL_NAME_TO_ID[normalizedPoolName]
    || `endgacha_kwer_${hashEndgachaPoolName(normalizedPoolName)}`;
}

function inferEndgachaPoolType(poolId, poolName) {
  const normalizedPoolName = normalizeExternalText(poolName);
  if (normalizedPoolName.includes('申领')) {
    return 'weapon';
  }
  if (normalizedPoolName.includes('基础')) {
    return 'standard';
  }
  if (normalizedPoolName.includes('启程')) {
    return 'beginner';
  }
  if (normalizedPoolName.includes('辉光') || normalizedPoolName.includes('庆典') || normalizedPoolName.includes('附加')) {
    return 'extra';
  }
  return inferPoolType({ poolId });
}

function looksLikeEndgachaEntry(entry) {
  if (Array.isArray(entry)) {
    const name = pickText(entry[0]);
    const rarity = Number(entry[1]);
    return Boolean(name && Number.isInteger(rarity) && rarity >= 3 && rarity <= 6);
  }

  if (!isPlainObject(entry)) {
    return false;
  }

  const name = pickText(entry.name, entry.n, entry.itemName);
  const rarity = Number(entry.rarity ?? entry.r);
  return Boolean(name && Number.isInteger(rarity) && rarity >= 3 && rarity <= 6);
}

function normalizeEndgachaRarity(value) {
  const rarity = Number(value);
  if (!Number.isInteger(rarity)) {
    return null;
  }

  // endgacha.kwer.top stores Endfield rarity as star - 1 in its exported records.
  if (rarity >= 3 && rarity <= 5) {
    return rarity + 1;
  }

  return rarity;
}

function looksLikeEndgachaBatch(batch) {
  return Boolean(
    isPlainObject(batch)
    && pickText(batch.p, batch.poolName, batch.pool_name)
    && Array.isArray(batch.c)
    && batch.c.some(looksLikeEndgachaEntry)
  );
}

function looksLikeEndgachaBatchMap(value) {
  return Boolean(
    isPlainObject(value)
    && Object.entries(value).some(([timestamp, batch]) => (
      normalizeExternalTimestamp(timestamp) && looksLikeEndgachaBatch(batch)
    ))
  );
}

function looksLikeEndgachaVerifiedPayload(data) {
  return Boolean(
    isPlainObject(data)
    && isPlainObject(data.info)
    && normalizeText(data.info.export_app).toLowerCase() === 'endgacha'
    && normalizeText(data.info.export_type).toLowerCase() === 'gacha'
    && pickText(data.info.verify)
    && looksLikeEndgachaBatchMap(data.data)
  );
}

function looksLikeEndgachaPlainJsonPayload(data) {
  return Boolean(
    isPlainObject(data)
    && !isPlainObject(data.info)
    && !Array.isArray(data.history)
    && looksLikeEndgachaBatchMap(data)
  );
}

function looksLikeEndgachaPlainTxtPayload(data) {
  return Boolean(
    isPlainObject(data)
    && normalizeText(data.formatId) === 'endgacha_kwer_top_plain_txt'
    && looksLikeEndgachaBatchMap(data.data)
  );
}

function normalizeEndgachaAccountInfo(info = {}) {
  const gameUid = normalizeGameUidText(info.uid || info.gameUid || info.game_uid);
  if (!gameUid) {
    return null;
  }

  const channelName = pickText(info.channelName, info.channel_name, info.channel);
  return {
    gameUid,
    nickName: pickText(info.nickName, info.nick_name, gameUid),
    channelName,
    isOfficial: normalizeText(channelName).toLowerCase() === 'official' ? true : null
  };
}

function normalizeEndgachaEntry(entry) {
  if (Array.isArray(entry)) {
    return {
      name: pickText(entry[0]),
      rarity: normalizeEndgachaRarity(entry[1]),
      isNew: normalizeExternalBoolean(entry[2]),
      isFree: normalizeExternalBoolean(entry[3])
    };
  }

  return {
    name: pickText(entry.name, entry.n, entry.itemName),
    rarity: normalizeEndgachaRarity(entry.rarity ?? entry.r),
    isNew: normalizeExternalBoolean(entry.isNew ?? entry.is_new ?? entry.new),
    isFree: normalizeExternalBoolean(entry.isFree ?? entry.is_free ?? entry.free)
  };
}

function normalizeEndgachaEntrySeqId(batch, itemIndex, itemCount) {
  const batchSeqText = pickText(batch?.seq, batch?.seqId, batch?.seq_id);
  if (!/^\d+$/.test(batchSeqText)) {
    return null;
  }

  const batchSeq = Number.parseInt(batchSeqText, 10);
  if (!Number.isSafeInteger(batchSeq) || batchSeq <= 0 || !Number.isInteger(itemIndex) || itemIndex < 0) {
    return null;
  }

  const count = Number.isInteger(itemCount) && itemCount > 0 ? itemCount : 1;
  const firstSeq = batchSeq - count + 1;
  const entrySeq = firstSeq + itemIndex;
  if (!Number.isSafeInteger(entrySeq) || entrySeq <= 0) {
    return null;
  }

  return String(entrySeq);
}

function normalizeEndgachaKwerTopPayload(data) {
  const batchMap = looksLikeEndgachaPlainTxtPayload(data)
    ? data.data
    : looksLikeEndgachaVerifiedPayload(data)
      ? data.data
      : data;
  const info = isPlainObject(data.info) ? data.info : {};
  const account = normalizeEndgachaAccountInfo(info);
  const pools = new Map();
  const history = [];
  const sortedBatches = Object.entries(batchMap)
    .filter(([, batch]) => looksLikeEndgachaBatch(batch))
    .sort(([left], [right]) => Number(left) - Number(right));

  sortedBatches.forEach(([timestampKey, batch]) => {
    const poolName = pickText(batch.p, batch.poolName, batch.pool_name);
    const poolId = resolveEndgachaPoolId(poolName, batch.pi || batch.poolId || batch.pool_id);
    const poolType = inferEndgachaPoolType(poolId, poolName);
    const timestamp = normalizeExternalTimestamp(timestampKey);
    const category = poolType === 'weapon' ? 'weapon' : 'character';

    upsertExternalPool(pools, {
      poolId,
      poolName,
      poolType,
      category
    });

    batch.c.forEach((entry, itemIndex) => {
      const normalizedEntry = normalizeEndgachaEntry(entry);
      if (!normalizedEntry.name || !timestamp) {
        return;
      }

      const sourceSeqId = normalizeEndgachaEntrySeqId(batch, itemIndex, batch.c.length);

      const recordId = [
        'endgacha',
        account?.gameUid || 'unknown',
        poolId,
        timestampKey,
        itemIndex
      ].join(':');

      history.push({
        id: recordId,
        record_id: recordId,
        poolId,
        pool_id: poolId,
        rarity: normalizedEntry.rarity,
        name: normalizedEntry.name,
        item_name: normalizedEntry.name,
        character_name: normalizedEntry.name,
        timestamp,
        batchId: `endgacha:${timestampKey}`,
        batch_id: `endgacha:${timestampKey}`,
        seqId: sourceSeqId || recordId,
        seq_id: sourceSeqId || recordId,
        isNew: normalizedEntry.isNew,
        is_new: normalizedEntry.isNew,
        isFree: normalizedEntry.isFree,
        is_free: normalizedEntry.isFree,
        gameUid: account?.gameUid || null,
        game_uid: account?.gameUid || null,
        nickName: account?.nickName || null,
        nick_name: account?.nickName || null,
        channelName: account?.channelName || null,
        channel_name: account?.channelName || null,
        isOfficial: account?.isOfficial ?? null,
        is_official: account?.isOfficial ?? null,
        category
      });
    });
  });

  return {
    formatId: normalizeText(data.formatId) || (account ? 'endgacha_kwer_top_verified_json' : 'endgacha_kwer_top_plain_json'),
    schemaVersion: '3.0.0',
    exportTime: normalizeExternalTimestamp(info.export_timestamp)
      || normalizeExternalTimestamp(info.export_time)
      || new Date().toISOString(),
    accountInfoMissing: !account,
    importWarningCodes: account ? [] : ['missing_account_info'],
    accounts: account ? [account] : [],
    pools: Array.from(pools.values()),
    history
  };
}

function inferBhaooAccountFromFileName(sourceFileName) {
  const baseName = pickText(sourceFileName).split(/[\\/]/).pop() || '';
  const match = baseName.match(/(\d{5,})_(\d{5,})(?:\.[^.]+)?$/);
  if (!match) {
    return null;
  }

  const [, hgUid, roleId] = match;
  return {
    uid: hgUid,
    hgUid,
    provider: 'hypergryph',
    roleId: {
      roleId,
      nickName: roleId,
      serverId: '1',
      serverName: '官服'
    }
  };
}

function normalizeBhaooAccount(account = {}) {
  const role = isPlainObject(account?.roleId) ? account.roleId : {};
  const rawRoleId = isPlainObject(account?.roleId) ? null : account.roleId;
  const gameUid = pickText(role.roleId, account.gameUid, account.game_uid, rawRoleId, account.uid, account.key);
  if (!gameUid) {
    return null;
  }

  return {
    gameUid,
    nickName: pickText(role.nickName, account.nickName, gameUid),
    channelName: pickText(account.provider, account.channelName),
    hgUid: pickText(account.hgUid, account.hg_uid, account.uid),
    channelMasterId: pickText(account.channelMasterId, account.channel_master_id),
    serverId: pickText(role.serverId, account.serverId),
    region: pickText(role.serverName, account.region),
    isOfficial: normalizeText(account.provider).toLowerCase() === 'hypergryph' ? true : null
  };
}

function looksLikeBhaooRecord(record) {
  return Boolean(
    isPlainObject(record)
    && (
      'charName' in record
      || 'weaponName' in record
      || 'gachaTs' in record
      || 'seqId' in record
    )
  );
}

function hasBhaooRecordMap(value) {
  return Boolean(
    isPlainObject(value)
    && Object.values(value).some((records) => (
      Array.isArray(records) && records.some(looksLikeBhaooRecord)
    ))
  );
}

function looksLikeBhaooEndfieldGachaPayload(data) {
  return Boolean(
    isPlainObject(data)
    && !Array.isArray(data.history)
    && (hasBhaooRecordMap(data.character) || hasBhaooRecordMap(data.weapon))
  );
}

function normalizeBhaooEndfieldGachaPayload(data, options = {}) {
  const pools = new Map();
  const history = [];
  const account = normalizeBhaooAccount(data.account || inferBhaooAccountFromFileName(options.sourceFileName));

  const collect = (recordMap, category) => {
    if (!isPlainObject(recordMap)) {
      return;
    }

    Object.entries(recordMap).forEach(([poolKey, records]) => {
      if (!Array.isArray(records)) {
        return;
      }

      records.forEach((record, index) => {
        if (!isPlainObject(record)) {
          return;
        }

        const poolId = pickText(record.poolId, record.pool_id, poolKey);
        const poolName = pickText(record.poolName, record.pool_name, poolId);
        const timestamp = normalizeExternalTimestamp(record.gachaTs || record.timestamp);
        const itemName = category === 'weapon'
          ? pickText(record.weaponName, record.itemName)
          : pickText(record.charName, record.itemName);
        const itemId = category === 'weapon'
          ? pickText(record.weaponId, record.itemId)
          : pickText(record.charId, record.itemId);
        const seqId = pickText(record.seqId, record.seq_id);
        const recordId = pickText(
          record.recordUid,
          record.id,
          seqId,
          `${category}:${poolId}:${itemName}:${timestamp || index}`
        );

        upsertExternalPool(pools, { poolId, poolName, category });

        history.push({
          id: recordId,
          record_id: recordId,
          poolId,
          pool_id: poolId,
          rarity: record.rarity,
          name: itemName,
          item_name: itemName,
          character_id: itemId,
          timestamp,
          seqId,
          seq_id: seqId,
          isNew: normalizeExternalBoolean(record.isNew),
          is_new: normalizeExternalBoolean(record.isNew),
          isFree: normalizeExternalBoolean(record.isFree),
          is_free: normalizeExternalBoolean(record.isFree),
          gameUid: account?.gameUid || null,
          game_uid: account?.gameUid || null,
          nickName: account?.nickName || null,
          nick_name: account?.nickName || null,
          channelName: account?.channelName || null,
          channel_name: account?.channelName || null,
          hgUid: account?.hgUid || null,
          hg_uid: account?.hgUid || null,
          channelMasterId: account?.channelMasterId || null,
          channel_master_id: account?.channelMasterId || null,
          serverId: account?.serverId || null,
          server_id: account?.serverId || null,
          region: account?.region || null,
          isOfficial: account?.isOfficial ?? null,
          is_official: account?.isOfficial ?? null
        });
      });
    });
  };

  collect(data.character, 'character');
  collect(data.weapon, 'weapon');

  return {
    formatId: 'bhaoo_endfield_gacha_json',
    schemaVersion: '3.0.0',
    exportTime: normalizeExternalTimestamp(data.updatedAt) || new Date().toISOString(),
    accounts: account ? [account] : [],
    pools: Array.from(pools.values()),
    history
  };
}

function looksLikeEndfieldGachaHelperRecord(record) {
  return Boolean(
    isPlainObject(record)
    && (
      'recordUid' in record
      || 'gachaTs' in record
      || 'pulledAt' in record
    )
    && (
      'poolId' in record
      || 'pool' in record
      || 'poolName' in record
    )
    && (
      'itemName' in record
      || 'charName' in record
      || 'weaponName' in record
      || 'charId' in record
      || 'weaponId' in record
    )
  );
}

function looksLikeEndfieldGachaHelperPayload(data) {
  return Boolean(
    isPlainObject(data)
    && (
      (Array.isArray(data.records) && data.records.some(looksLikeEndfieldGachaHelperRecord))
      || (Array.isArray(data.weaponRecords) && data.weaponRecords.some(looksLikeEndfieldGachaHelperRecord))
      || (Array.isArray(data.gachaRecords) && data.gachaRecords.some(looksLikeEndfieldGachaHelperRecord))
    )
  );
}

function normalizeEndfieldGachaHelperAccount(account = {}) {
  const roles = Array.isArray(account.roles) ? account.roles : [];
  const role = roles.find(item => pickText(item.roleId) === pickText(account.roleId)) || roles[0] || {};
  const gameUid = normalizeGameUidText(pickText(role.roleId, account.roleId, account.gameUid, account.game_uid, account.uid));
  if (!gameUid) {
    return null;
  }

  return {
    gameUid,
    nickName: pickText(role.nickName, account.nickName, gameUid),
    channelName: pickText(account.channelName, account.provider),
    hgUid: pickText(account.hgUid, account.hg_uid),
    channelMasterId: pickText(account.channelMasterId, account.channel_master_id),
    serverId: pickText(account.serverId, role.serverId),
    region: pickText(role.serverName, account.region),
    isOfficial: normalizeText(account.provider).toLowerCase() === 'hypergryph' ? true : null
  };
}

function normalizeEndfieldGachaHelperRecord(record, categorySeed, poolMap, index) {
  const category = pickText(
    record.category,
    categorySeed,
    record.weaponName || record.weaponId ? 'weapon' : 'character'
  ).toLowerCase() === 'weapon' ? 'weapon' : 'character';
  const poolId = upsertExternalPool(poolMap, {
    poolId: record.poolId || record.pool_id || record.pool,
    poolName: record.poolName || record.pool_name || record.pool,
    poolType: record.poolType || record.pool_type,
    category
  });
  const timestamp = normalizeExternalTimestamp(record.gachaTs || record.pulledAt || record.timestamp);
  const itemName = pickText(record.itemName, record.charName, record.characterName, record.weaponName);
  const itemId = pickText(record.itemId, record.charId, record.characterId, record.weaponId);
  const seqId = pickText(record.seqId, record.seq_id);
  const recordId = pickText(
    record.recordUid,
    record.record_id,
    record.id,
    seqId,
    `${category}:${poolId || 'unknown_pool'}:${itemName}:${timestamp || index}`
  );
  const gameUid = normalizeGameUidText(pickText(record.gameUid, record.game_uid, record.uid));

  return {
    id: recordId,
    record_id: recordId,
    poolId,
    pool_id: poolId,
    rarity: record.rarity,
    name: itemName,
    item_name: itemName,
    character_id: itemId,
    timestamp,
    seqId,
    seq_id: seqId,
    isNew: normalizeExternalBoolean(record.isNew),
    is_new: normalizeExternalBoolean(record.isNew),
    isFree: normalizeExternalBoolean(record.isFree),
    is_free: normalizeExternalBoolean(record.isFree),
    gameUid: gameUid || null,
    game_uid: gameUid || null,
    region: pickText(record.region) || null
  };
}

function normalizeEndfieldGachaHelperPayload(data) {
  const pools = new Map();
  const accounts = (Array.isArray(data.accounts) ? data.accounts : [])
    .map(normalizeEndfieldGachaHelperAccount)
    .filter(Boolean);
  const history = [
    ...(Array.isArray(data.records) ? data.records.map((record, index) => normalizeEndfieldGachaHelperRecord(record, 'character', pools, index)) : []),
    ...(Array.isArray(data.gachaRecords) ? data.gachaRecords.map((record, index) => normalizeEndfieldGachaHelperRecord(record, 'character', pools, index)) : []),
    ...(Array.isArray(data.weaponRecords) ? data.weaponRecords.map((record, index) => normalizeEndfieldGachaHelperRecord(record, 'weapon', pools, index)) : [])
  ];

  return {
    formatId: 'endfield_gacha_helper_json',
    schemaVersion: '3.0.0',
    exportTime: normalizeExternalTimestamp(data.exportedAt) || new Date().toISOString(),
    accounts,
    pools: Array.from(pools.values()),
    history
  };
}

function looksLikeInternalPayload(data) {
  return Boolean(
    data
    && typeof data === 'object'
    && Array.isArray(data.pools)
    && Array.isArray(data.history)
  );
}

function looksLikeLegacyInternalPayload(data) {
  if (!looksLikeInternalPayload(data)) {
    return false;
  }

  const schemaVersion = normalizeText(data.schemaVersion || data.version);
  if (schemaVersion === '3.0' || schemaVersion === '3.0.0') {
    return false;
  }

  const sampleRecord = Array.isArray(data.history) ? data.history.find(Boolean) : null;
  const samplePool = Array.isArray(data.pools) ? data.pools.find(Boolean) : null;

  return Boolean(
    (sampleRecord && (
      'pool_id' in sampleRecord
      || 'item_name' in sampleRecord
      || 'character_id' in sampleRecord
      || 'seq_id' in sampleRecord
    ))
    || (samplePool && (
      'pool_id' in samplePool
      || 'up_character' in samplePool
      || 'is_limited_weapon' in samplePool
    ))
  );
}

function looksLikeCurrentInternalPayload(data) {
  if (!looksLikeInternalPayload(data)) {
    return false;
  }

  const formatId = normalizeText(data.formatId);
  if (formatId && formatId !== 'internal_json_v3') {
    return false;
  }

  const schemaVersion = normalizeText(data.schemaVersion || data.version);
  return schemaVersion === '3.0' || schemaVersion === '3.0.0';
}

function looksLikeBhaooEndfieldGachaXlsxPayload(data) {
  return Boolean(
    looksLikeInternalPayload(data)
    && normalizeText(data.formatId) === 'bhaoo_endfield_gacha_xlsx'
  );
}

export const DATA_FORMAT_REGISTRY = Object.freeze([
  {
    id: 'internal_json_v3',
    label: '站内 JSON v3',
    direction: ['import', 'export'],
    kind: 'json',
    fileExtensions: ['json'],
    detect: looksLikeCurrentInternalPayload,
    normalizeImportPayload: passthroughImportPayload,
  },
  {
    id: 'internal_json_legacy',
    label: '站内旧版 JSON',
    direction: ['import'],
    kind: 'json',
    fileExtensions: ['json'],
    detect: looksLikeLegacyInternalPayload,
    normalizeImportPayload: passthroughImportPayload,
  },
  {
    id: 'bhaoo_endfield_gacha_xlsx',
    label: 'EndfieldGacha Excel',
    direction: ['import'],
    kind: 'xlsx',
    fileExtensions: ['xlsx'],
    detect: looksLikeBhaooEndfieldGachaXlsxPayload,
    normalizeImportPayload: passthroughImportPayload,
  },
  {
    id: 'bhaoo_endfield_gacha_userdata_zip',
    label: 'EndfieldGacha userData ZIP',
    direction: ['export'],
    kind: 'zip',
    fileExtensions: ['zip'],
    detect: () => false,
  },
  {
    id: 'internal_csv_flat',
    label: '站内 CSV 平铺导出',
    direction: ['export'],
    kind: 'csv',
    fileExtensions: ['csv'],
    detect: () => false,
  },
  {
    id: 'bhaoo_endfield_gacha_json',
    label: 'EndfieldGacha WebDAV JSON',
    direction: ['import'],
    kind: 'json',
    fileExtensions: ['json'],
    detect: looksLikeBhaooEndfieldGachaPayload,
    normalizeImportPayload: normalizeBhaooEndfieldGachaPayload,
  },
  {
    id: 'endgacha_kwer_top_verified_json',
    label: 'endgacha.kwer.top 校验 JSON',
    direction: ['import'],
    kind: 'json',
    fileExtensions: ['json'],
    detect: looksLikeEndgachaVerifiedPayload,
    normalizeImportPayload: normalizeEndgachaKwerTopPayload,
  },
  {
    id: 'endgacha_kwer_top_plain_json',
    label: 'endgacha.kwer.top 纯寻访 JSON',
    direction: ['import', 'export'],
    kind: 'json',
    fileExtensions: ['json'],
    detect: looksLikeEndgachaPlainJsonPayload,
    normalizeImportPayload: normalizeEndgachaKwerTopPayload,
  },
  {
    id: 'endgacha_kwer_top_plain_txt',
    label: 'endgacha.kwer.top 纯寻访 TXT',
    direction: ['import', 'export'],
    kind: 'txt',
    fileExtensions: ['txt'],
    detect: looksLikeEndgachaPlainTxtPayload,
    normalizeImportPayload: normalizeEndgachaKwerTopPayload,
  },
  {
    id: 'endfield_gacha_helper_json',
    label: 'EndfieldGachaHelper JSON',
    direction: ['import', 'export'],
    kind: 'json',
    fileExtensions: ['endfieldgacha.json', 'json'],
    detect: looksLikeEndfieldGachaHelperPayload,
    normalizeImportPayload: normalizeEndfieldGachaHelperPayload,
  },
  {
    id: 'endfield_gacha_helper_csv',
    label: 'EndfieldGachaHelper CSV',
    direction: ['export'],
    kind: 'csv',
    fileExtensions: ['csv'],
    detect: () => false,
  },
  {
    id: 'endfield_gacha_helper_userdata_zip',
    label: 'EndfieldGachaHelper userdata ZIP',
    direction: ['export'],
    kind: 'zip',
    fileExtensions: ['zip'],
    detect: () => false,
  },
]);

export function listSupportedImportFormats() {
  return DATA_FORMAT_REGISTRY.filter(format => format.direction.includes('import'));
}

export function listSupportedExportFormats() {
  return DATA_FORMAT_REGISTRY.filter(format => format.direction.includes('export'));
}

export function getDataFormatById(formatId) {
  const normalized = normalizeText(formatId);
  return DATA_FORMAT_REGISTRY.find(format => format.id === normalized) || null;
}

export function detectImportFormat(data) {
  return listSupportedImportFormats().find(format => format.detect(data)) || null;
}

export function prepareImportPayload(data, format = null, options = {}) {
  const resolvedFormat = format || detectImportFormat(data);
  if (!resolvedFormat) {
    return data;
  }

  if (typeof resolvedFormat.normalizeImportPayload !== 'function') {
    return data;
  }

  return resolvedFormat.normalizeImportPayload(data, options);
}
