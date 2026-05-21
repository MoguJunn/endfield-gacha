import {
  classifyCharacterIdSource,
  classifyPoolIdSource,
} from './canonicalEntityUtils.js';

const ALIAS_QUERY_CHUNK_SIZE = 200;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueTextValues(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(value => normalizeText(value))
      .filter(Boolean)
  ));
}

function chunkValues(values, chunkSize = ALIAS_QUERY_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function pickPreferredAliasRow(rows, preferredSource = null) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return [...rows].sort((left, right) => {
    const leftPreferred = preferredSource && left.source === preferredSource ? 1 : 0;
    const rightPreferred = preferredSource && right.source === preferredSource ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    const leftPrimary = left.is_primary ? 1 : 0;
    const rightPrimary = right.is_primary ? 1 : 0;
    if (leftPrimary !== rightPrimary) {
      return rightPrimary - leftPrimary;
    }

    if (left.source === 'internal' && right.source !== 'internal') {
      return -1;
    }

    if (left.source !== 'internal' && right.source === 'internal') {
      return 1;
    }

    return Number(left.id || 0) - Number(right.id || 0);
  })[0];
}

async function loadAliasRows(supabaseClient, tableName, targetColumn, aliasIds) {
  const normalizedIds = uniqueTextValues(aliasIds);
  if (!supabaseClient || normalizedIds.length === 0) {
    return [];
  }

  const allRows = [];
  const chunks = chunkValues(normalizedIds);

  for (const chunk of chunks) {
    const { data, error } = await supabaseClient
      .from(tableName)
      .select(`id, source, alias_id, ${targetColumn}, is_primary`)
      .in('alias_id', chunk);

    if (error) {
      throw error;
    }

    allRows.push(...(data || []));
  }

  return allRows;
}

function buildResolvedAliasMap(rows, targetColumn, preferredSource = null) {
  const groupedRows = new Map();

  (rows || []).forEach((row) => {
    const aliasId = normalizeText(row?.alias_id);
    if (!aliasId) {
      return;
    }

    if (!groupedRows.has(aliasId)) {
      groupedRows.set(aliasId, []);
    }

    groupedRows.get(aliasId).push(row);
  });

  const resolved = new Map();
  groupedRows.forEach((group, aliasId) => {
    const preferredRow = pickPreferredAliasRow(group, preferredSource);
    const targetId = normalizeText(preferredRow?.[targetColumn]);
    if (targetId) {
      resolved.set(aliasId, targetId);
    }
  });

  return resolved;
}

async function resolveAliasMap(supabaseClient, {
  tableName,
  targetColumn,
  aliasIds,
  preferredSource = null,
}) {
  const rows = await loadAliasRows(supabaseClient, tableName, targetColumn, aliasIds);
  return buildResolvedAliasMap(rows, targetColumn, preferredSource);
}

export async function resolveCharacterAliasMap(supabaseClient, aliasIds, preferredSource = null) {
  return resolveAliasMap(supabaseClient, {
    tableName: 'character_id_aliases',
    targetColumn: 'character_id',
    aliasIds,
    preferredSource,
  });
}

export async function resolvePoolAliasMap(supabaseClient, aliasIds, preferredSource = null) {
  return resolveAliasMap(supabaseClient, {
    tableName: 'pool_id_aliases',
    targetColumn: 'pool_id',
    aliasIds,
    preferredSource,
  });
}

export function resolveAliasValue(aliasMap, inputValue) {
  const normalized = normalizeText(inputValue);
  if (!normalized) {
    return null;
  }

  return aliasMap?.get(normalized) || normalized;
}

export function inferCharacterAliasSource(characterId, preferredSource = null) {
  if (preferredSource) {
    return preferredSource;
  }

  switch (classifyCharacterIdSource(characterId)) {
    case 'manual_placeholder':
      return 'manual_placeholder';
    case 'seeded':
      return 'wiki';
    case 'source_raw':
      return 'official_api';
    default:
      return null;
  }
}

export function inferPoolAliasSource(poolId, preferredSource = null) {
  if (preferredSource) {
    return preferredSource;
  }

  switch (classifyPoolIdSource(poolId)) {
    case 'official':
      return 'official_api';
    case 'manual_placeholder':
      return 'manual_placeholder';
    case 'legacy_manual_seed':
      return 'legacy_manual';
    default:
      return null;
  }
}

function dedupeAliasRows(rows) {
  const deduped = new Map();

  (rows || []).forEach((row) => {
    const source = normalizeText(row?.source);
    const aliasId = normalizeText(row?.alias_id);
    if (!source || !aliasId) {
      return;
    }

    deduped.set(`${source}:${aliasId}`, {
      ...row,
      source,
      alias_id: aliasId,
      note: row?.note || null,
      is_primary: Boolean(row?.is_primary),
    });
  });

  return Array.from(deduped.values());
}

function buildSelfAliasRows(targetId, inferredSource, notePrefix) {
  const normalizedTargetId = normalizeText(targetId);
  if (!normalizedTargetId) {
    return [];
  }

  const rows = [{
    source: 'internal',
    alias_id: normalizedTargetId,
    is_primary: true,
    note: `${notePrefix} self alias`,
  }];

  if (inferredSource && inferredSource !== 'internal') {
    rows.push({
      source: inferredSource,
      alias_id: normalizedTargetId,
      is_primary: true,
      note: `${notePrefix} source alias`,
    });
  }

  return rows;
}

export function buildCharacterSelfAliasRows(characterId, preferredSource = null) {
  return buildSelfAliasRows(
    characterId,
    inferCharacterAliasSource(characterId, preferredSource),
    'Character canonical'
  ).map(row => ({
    ...row,
    character_id: normalizeText(characterId),
  }));
}

export function buildPoolSelfAliasRows(poolId, preferredSource = null) {
  return buildSelfAliasRows(
    poolId,
    inferPoolAliasSource(poolId, preferredSource),
    'Pool canonical'
  ).map(row => ({
    ...row,
    pool_id: normalizeText(poolId),
  }));
}

export async function upsertCharacterAliases(supabaseClient, rows) {
  const normalizedRows = dedupeAliasRows(rows)
    .map(row => ({
      ...row,
      character_id: normalizeText(row.character_id),
    }))
    .filter(row => row.character_id);

  if (!supabaseClient || normalizedRows.length === 0) {
    return;
  }

  const { error } = await supabaseClient
    .from('character_id_aliases')
    .upsert(normalizedRows, { onConflict: 'source,alias_id' });

  if (error) {
    throw error;
  }
}

export async function upsertPoolAliases(supabaseClient, rows) {
  const normalizedRows = dedupeAliasRows(rows)
    .map(row => ({
      ...row,
      pool_id: normalizeText(row.pool_id),
    }))
    .filter(row => row.pool_id);

  if (!supabaseClient || normalizedRows.length === 0) {
    return;
  }

  const { error } = await supabaseClient
    .from('pool_id_aliases')
    .upsert(normalizedRows, { onConflict: 'source,alias_id' });

  if (error) {
    throw error;
  }
}
