export const EXTRA_POOL_SUBTYPES = Object.freeze({
  RECONSTRUCTION: 'reconstruction',
  RECONSTRUCTION_CLAIM: 'reconstruction_claim',
  SPECIAL: 'special',
});

export const EXTRA_POOL_RULE_PROFILES = Object.freeze({
  RECONSTRUCTION_CHARACTER: 'reconstruction_character_v1',
  RECONSTRUCTION_WEAPON: 'reconstruction_weapon_v1',
  BRILLIANCE_FESTIVAL: 'brilliance_festival_v1',
});

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

export function getExtraPoolRuleProfile(pool = {}) {
  const source = pool || {};
  return normalizeText(source.extra_rule_profile ?? source.extraRuleProfile) || null;
}

export function canonicalizeExtraPoolSubtype(subtype, ruleProfile) {
  const normalizedSubtype = normalizeText(subtype) || null;
  const normalizedProfile = normalizeText(ruleProfile) || null;

  if (
    normalizedSubtype === EXTRA_POOL_SUBTYPES.RECONSTRUCTION
    && normalizedProfile === EXTRA_POOL_RULE_PROFILES.RECONSTRUCTION_WEAPON
  ) {
    return EXTRA_POOL_SUBTYPES.RECONSTRUCTION_CLAIM;
  }

  return normalizedSubtype;
}

export function getCanonicalExtraPoolSubtype(pool = {}) {
  const source = pool || {};
  return canonicalizeExtraPoolSubtype(
    source.extra_subtype ?? source.extraSubtype,
    getExtraPoolRuleProfile(source)
  );
}

export function getExpectedExtraPoolSubtype(ruleProfile) {
  switch (normalizeText(ruleProfile)) {
    case EXTRA_POOL_RULE_PROFILES.RECONSTRUCTION_CHARACTER:
      return EXTRA_POOL_SUBTYPES.RECONSTRUCTION;
    case EXTRA_POOL_RULE_PROFILES.RECONSTRUCTION_WEAPON:
      return EXTRA_POOL_SUBTYPES.RECONSTRUCTION_CLAIM;
    case EXTRA_POOL_RULE_PROFILES.BRILLIANCE_FESTIVAL:
      return EXTRA_POOL_SUBTYPES.SPECIAL;
    default:
      return null;
  }
}

export function getCanonicalExtraPoolMetadata(pool = {}) {
  const source = pool || {};
  const ruleProfile = getExtraPoolRuleProfile(source);
  const rawPhase = source.extra_series_phase ?? source.extraSeriesPhase;

  return {
    extra_subtype: canonicalizeExtraPoolSubtype(
      source.extra_subtype ?? source.extraSubtype,
      ruleProfile
    ),
    extra_rule_profile: ruleProfile,
    extra_series_key: normalizeText(source.extra_series_key ?? source.extraSeriesKey) || null,
    extra_series_phase: rawPhase !== null
      && rawPhase !== undefined
      && rawPhase !== ''
      && Number.isInteger(Number(rawPhase))
      ? Number(rawPhase)
      : null,
  };
}

export function canonicalizeExtraPoolRecord(pool = {}) {
  const source = pool || {};
  const canonicalSubtype = getCanonicalExtraPoolSubtype(source);
  const rawSubtype = normalizeText(source.extra_subtype ?? source.extraSubtype) || null;
  if (canonicalSubtype === rawSubtype) {
    return source;
  }

  return {
    ...source,
    extra_subtype: canonicalSubtype,
    ...(Object.prototype.hasOwnProperty.call(source, 'extraSubtype')
      ? { extraSubtype: canonicalSubtype }
      : {}),
  };
}

export default {
  EXTRA_POOL_SUBTYPES,
  EXTRA_POOL_RULE_PROFILES,
  canonicalizeExtraPoolSubtype,
  canonicalizeExtraPoolRecord,
  getCanonicalExtraPoolMetadata,
  getCanonicalExtraPoolSubtype,
  getExpectedExtraPoolSubtype,
  getExtraPoolRuleProfile,
};
