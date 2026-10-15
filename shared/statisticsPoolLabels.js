function mapValues(object, project) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, project(value, key)]));
}

function localizedName(pool, locale) {
  return locale === 'en-US' ? pool.name_en || pool.name : pool.name;
}

// Only known pool-label fields are projected. Statistical values, character
// names and timeline identities always remain those of the completed snapshot.
export function projectStatisticsPoolLabels(payload, pools) {
  const byId = new Map(pools.map((pool) => [pool.pool_id || pool.id, pool]));
  const label = (id, fallback, locale = 'zh-CN') => {
    const pool = byId.get(id);
    return pool ? localizedName(pool, locale) : fallback;
  };
  const observations = (value) => {
    if (!value?.members) return value;
    return {
      ...value,
      members: value.members.map((member) => {
        const pool = byId.get(member.id);
        return pool ? { ...member, name: pool.name, nameEn: pool.name_en } : member;
      }),
    };
  };
  const character = (row, locale) => ({
    ...row,
    firstAcquiredPoolName: label(row.firstAcquiredPoolId, row.firstAcquiredPoolName, locale),
    lastAcquiredPoolName: label(row.lastAcquiredPoolId, row.lastAcquiredPoolName, locale),
    ...(row.acquisitionPulls ? {
      acquisitionPulls: row.acquisitionPulls.map((pull) => ({
        ...pull, poolName: label(pull.poolId, pull.poolName, locale),
      })),
    } : {}),
  });
  const catalog = (value, locale) => ({
    ...value,
    rows: value.rows.map((row) => character(row, locale)),
    ...(value.ledger ? {
      ledger: {
        ...value.ledger,
        characterRows: value.ledger.characterRows.map((row) => character(row, locale)),
        charactersByKey: mapValues(value.ledger.charactersByKey, (row) => character(row, locale)),
      },
    } : {}),
  });
  const result = { ...payload };
  if (payload.observations) result.observations = observations(payload.observations);
  if (payload.pools) result.pools = payload.pools.map((pool) => {
    const current = byId.get(pool.id);
    return current ? { ...pool, name: current.name, name_en: current.name_en } : pool;
  });
  if (payload.groupScopes) result.groupScopes = mapValues(payload.groupScopes, (groups) =>
    mapValues(groups, (group) => ({ ...group, observations: observations(group.observations) })));
  if (payload.catalogs) result.catalogs = mapValues(payload.catalogs, (locales) => mapValues(locales, catalog));
  return result;
}

export function projectPersonalAnalysisPoolLabels(payload, pools) {
  const byId = new Map(pools.map((pool) => [pool.pool_id || pool.id, pool]));
  const result = {
    ...payload,
    poolManifest: payload.poolManifest.map((pool) => {
      const current = byId.get(pool.pool_id || pool.id);
      return current ? { ...pool, name: current.name, name_en: current.name_en,
        description: current.description, banner_url: current.banner_url } : pool;
    }),
  };
  if (payload.dashboard?.timelineViews) result.dashboard = {
    ...payload.dashboard,
    timelineViews: mapValues(payload.dashboard.timelineViews, (views, locale) =>
      mapValues(views, (sections) => sections.map((section) => {
        const current = byId.get(section.id);
        return current ? { ...section, title: localizedName(current, locale) } : section;
      }))),
  };
  return result;
}
