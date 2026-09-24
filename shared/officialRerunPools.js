import { getCanonicalExtraPoolMetadata } from './extraPoolSubtype.js';

export const RERUN_CHARACTER_TYPE = 'E_CharacterGachaPoolType_Rerun';

export function getOfficialRerunProfile(record = {}, context = {}) {
  const sourceType = record.sourcePoolType || record.poolType || record.pool_type || context.poolType;
  if (sourceType === RERUN_CHARACTER_TYPE) return 'reconstruction_character_v1';
  if (sourceType === 'rerun') {
    return context.type === 'weapon' || record.recordType === 'weapon' || record.weaponId
      ? 'reconstruction_weapon_v1'
      : 'reconstruction_character_v1';
  }
  return null;
}

// The official UI appends poolVersion to poolName; the suffix is never an ID.
export function getRerunBaseName(name) {
  return String(name || '').trim().replace(/\s*[#＃][1-9]\d*\s*$/u, '').trim();
}

export function resolveRerunPoolIdentity(pool, catalog = []) {
  const profile = pool.extra_rule_profile;
  if (!['reconstruction_character_v1', 'reconstruction_weapon_v1'].includes(profile)) return pool;
  const name = getRerunBaseName(pool.name);
  if (!name) throw new Error('重构寻访缺少官方卡池名称，无法确定跨期归属');
  const matches = [...new Map(catalog.filter((candidate) => (
    candidate.extra_rule_profile === profile
    && getRerunBaseName(candidate.name) === name
  )).map((candidate) => [String(candidate.pool_id || candidate.id), candidate])).values()];
  const exact = matches.find((candidate) => String(candidate.pool_id || candidate.id) === String(pool.pool_id));
  if (matches.length > 1 && !exact) {
    throw new Error(`重构卡池“${name}”存在多个同名目录项，需要先确认归属`);
  }
  const existing = exact || matches[0];
  if (existing) {
    return {
      ...pool,
      ...existing,
      pool_id: String(existing.pool_id || existing.id),
      name,
      type: 'extra',
      ...getCanonicalExtraPoolMetadata(existing),
    };
  }
  return {
    ...pool,
    name,
    type: 'extra',
    extra_subtype: profile === 'reconstruction_weapon_v1' ? 'reconstruction_claim' : 'reconstruction',
    extra_rule_profile: profile,
    extra_series_key: `rerun:${profile}:${name.normalize('NFKC')}`,
    // Catalog phase is not the record's occurrence; pool_version owns that value.
    extra_series_phase: 1,
  };
}
