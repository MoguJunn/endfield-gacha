const POOL_MAINTENANCE_SUFFIX = /\s*（前瞻(?:，[^）]*)?）\s*$/u;

export function cleanPoolDisplayName(value) {
  return String(value || '').replace(POOL_MAINTENANCE_SUFFIX, '').trim();
}

export function sanitizeVersionCalendarSnapshot(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    versionKey: row.version_key || null,
    revision: Number(row.revision) || 1,
    title: row.title || null,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    content: row.content && typeof row.content === 'object' ? row.content : {},
    poolBindings: row.pool_bindings && typeof row.pool_bindings === 'object'
      ? row.pool_bindings
      : {},
    sourceMeta: row.source_meta && typeof row.source_meta === 'object'
      ? row.source_meta
      : {},
    publishedAt: row.published_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function buildVersionCalendarPoolNames(poolRows = [], poolBindings = {}) {
  const requestedPoolIds = new Set(Object.values(poolBindings || {}).filter(Boolean));
  const poolNames = {};

  (Array.isArray(poolRows) ? poolRows : []).forEach((row) => {
    const poolId = row?.pool_id || row?.id || null;
    if (!poolId || !requestedPoolIds.has(poolId) || poolNames[poolId]) {
      return;
    }

    const name = cleanPoolDisplayName(row?.name);
    if (name) {
      poolNames[poolId] = name;
    }
  });

  return poolNames;
}

export function buildVersionCalendarPayload(snapshotRow, poolRows = []) {
  const snapshot = sanitizeVersionCalendarSnapshot(snapshotRow);
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    poolNames: buildVersionCalendarPoolNames(poolRows, snapshot.poolBindings),
  };
}
