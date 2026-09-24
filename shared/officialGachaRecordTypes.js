/** Official record requests shared by the browser and the private proxy. */
export const OFFICIAL_CHARACTER_POOL_TYPES = Object.freeze({
  SPECIAL: 'E_CharacterGachaPoolType_Special',
  JOINT: 'E_CharacterGachaPoolType_Joint',
  RERUN: 'E_CharacterGachaPoolType_Rerun',
  STANDARD: 'E_CharacterGachaPoolType_Standard',
  BEGINNER: 'E_CharacterGachaPoolType_Beginner',
});

// Rerun uses the character records endpoint; weapon reruns share the weapon feed.
// The rerun-counts endpoint contains cumulative totals, not individual draws.
export const DEFAULT_OFFICIAL_RECORD_REQUESTS = Object.freeze([
  ...Object.values(OFFICIAL_CHARACTER_POOL_TYPES).map((poolType) => Object.freeze({ type: 'char', poolType })),
  Object.freeze({ type: 'weapon' }),
]);

export const MAX_OFFICIAL_RECORD_BATCH_SIZE = DEFAULT_OFFICIAL_RECORD_REQUESTS.length;

const CHARACTER_LOCAL_TYPES = Object.freeze({
  [OFFICIAL_CHARACTER_POOL_TYPES.SPECIAL]: 'limited_character',
  [OFFICIAL_CHARACTER_POOL_TYPES.JOINT]: 'extra',
  [OFFICIAL_CHARACTER_POOL_TYPES.RERUN]: 'extra',
  [OFFICIAL_CHARACTER_POOL_TYPES.STANDARD]: 'standard',
  [OFFICIAL_CHARACTER_POOL_TYPES.BEGINNER]: 'beginner',
});

const CHARACTER_LABELS = Object.freeze({
  [OFFICIAL_CHARACTER_POOL_TYPES.SPECIAL]: '限定角色池',
  [OFFICIAL_CHARACTER_POOL_TYPES.JOINT]: '附加寻访',
  [OFFICIAL_CHARACTER_POOL_TYPES.RERUN]: '重构寻访',
  [OFFICIAL_CHARACTER_POOL_TYPES.STANDARD]: '常驻角色池',
  [OFFICIAL_CHARACTER_POOL_TYPES.BEGINNER]: '新手池',
});

export function getOfficialRecordRequestLabel({ type, poolType }) {
  return type === 'weapon' ? '武器池' : CHARACTER_LABELS[poolType] || '未知卡池';
}

export function getOfficialRecordLocalPoolType(record, { type, poolType } = {}) {
  if (type === 'weapon') {
    return (record.poolType ?? record.sourcePoolType) === 'rerun' ? 'extra' : 'limited_weapon';
  }
  return CHARACTER_LOCAL_TYPES[poolType ?? record.sourcePoolType] || 'unknown';
}

export function annotateOfficialGachaRecord(record, request) {
  return {
    ...record,
    // Preserve the official discriminator independently of the local bucket.
    // A request enum identifies character reruns; only record.poolType identifies weapon reruns.
    sourcePoolType: request.type === 'weapon'
      ? record.poolType ?? record.sourcePoolType ?? null
      : request.poolType ?? record.sourcePoolType ?? null,
    _poolType: getOfficialRecordLocalPoolType(record, request),
  };
}

export function buildOfficialRecordsUrl(sourceConfig, { u8Token, type = 'char', poolType, seqId, serverId = '1' }) {
  const endpoint = type === 'weapon' ? sourceConfig.recordsWeaponEndpoint : sourceConfig.recordsCharEndpoint;
  const url = new URL(endpoint);
  url.searchParams.set('token', u8Token);
  url.searchParams.set('server_id', serverId || '1');
  url.searchParams.set('lang', 'zh-cn');
  if (poolType) url.searchParams.set('pool_type', poolType);
  if (seqId) url.searchParams.set('seq_id', seqId);
  return url.toString();
}
