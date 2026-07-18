import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_RECORDS = 159;
const EXPECTED_USERS = 119;
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 45_000;
const APPLY_CONFIRMATION = `${EXPECTED_RECORDS}:${EXPECTED_USERS}`;
const ISSUE_CODE = 'OFFICIAL_IMPORT_UNKNOWN_ITEM';
const UNKNOWN_NAMES = new Set(['', '未知', 'unknown', '未知目标']);
const UNKNOWN_QUERY_NAMES = ['未知', 'unknown', 'Unknown', 'UNKNOWN', '未知目标'];
const EXPECTED_POOL_IDS = new Set(['special_1_4_1', 'weponbox_1_4_1']);
const HISTORY_COLUMNS =
  'user_id, record_id, game_uid, server_id, server_scope, region, pool_id, seq_id, character_id, character_name, item_name, rarity, timestamp, pity, created_at, updated_at';

for (const envPath of ['.env.local', '.env', 'backend/.env.local', 'backend/.env']) {
  loadEnv({ path: path.resolve(process.cwd(), envPath), override: false, quiet: true });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('缺少 SUPABASE_URL 与 SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, key };
}

function getDisplayName(row) {
  return String(row?.character_name || row?.item_name || '').trim();
}

function isUnknownName(value) {
  return UNKNOWN_NAMES.has(
    String(value ?? '')
      .trim()
      .toLowerCase()
  );
}

function getHistoryScopeKey(row) {
  return [row?.user_id, row?.game_uid, row?.server_scope, row?.pool_id, row?.seq_id]
    .map((value) => String(value ?? ''))
    .join('\u0000');
}

function isUnknownHistoryRow(row) {
  return isUnknownName(row?.character_name) && isUnknownName(row?.item_name);
}

function createTimedFetch(timeoutMs = REQUEST_TIMEOUT_MS) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

    try {
      return await fetch(input, { ...init, signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Supabase 请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function formatSupabaseError(error) {
  if (!error) return '未知数据库错误';
  return (
    [error.message, error.details, error.hint, error.code]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' / ') || '未知数据库错误'
  );
}

async function runCandidateQuery(label, query) {
  console.log(`正在读取${label}...`);
  const { data, error } = await query.limit(PAGE_SIZE);
  if (error) {
    throw new Error(`${label}读取失败：${formatSupabaseError(error)}`);
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length >= PAGE_SIZE) {
    throw new Error(`${label}达到 ${PAGE_SIZE} 条安全上限，请先收窄筛选条件后再继续。`);
  }
  console.log(`${label}读取完成：${rows.length} 条候选。`);
  return rows;
}

async function loadNullCharacterHistory(client) {
  const rows = [];
  rows.push(
    ...(await runCandidateQuery(
      '角色名称为未知值的记录',
      client.from('history').select(HISTORY_COLUMNS).is('character_id', null).in('character_name', UNKNOWN_QUERY_NAMES)
    ))
  );
  rows.push(
    ...(await runCandidateQuery(
      '角色名称缺失且物品名称未知的记录',
      client
        .from('history')
        .select(HISTORY_COLUMNS)
        .is('character_id', null)
        .is('character_name', null)
        .or(`item_name.in.(${UNKNOWN_QUERY_NAMES.join(',')}),item_name.is.null,item_name.eq.`)
    ))
  );
  rows.push(
    ...(await runCandidateQuery(
      '角色名称为空且物品名称未知的记录',
      client
        .from('history')
        .select(HISTORY_COLUMNS)
        .is('character_id', null)
        .eq('character_name', '')
        .or(`item_name.in.(${UNKNOWN_QUERY_NAMES.join(',')}),item_name.is.null,item_name.eq.`)
    ))
  );

  return Array.from(new Map(rows.map((row) => [getHistoryScopeKey(row), row])).values());
}

function buildDistribution(rows, getValue, { limit = 20 } = {}) {
  const counts = new Map();
  rows.forEach((row) => {
    const value = String(getValue(row) ?? '').trim() || '（空）';
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, limit);
}

function getDateBucket(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '（时间无效）' : date.toISOString().slice(0, 10);
}

function printDistribution(label, entries) {
  console.error(`${label}：${entries.map(([value, count]) => `${value}=${count}`).join('，') || '无'}`);
}

function printChronologicalDelta(rows) {
  const sorted = [...rows].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
  const originalWindow = sorted.slice(0, EXPECTED_RECORDS);
  const laterRows = sorted.slice(EXPECTED_RECORDS);
  const originalUsers = new Set(originalWindow.map((row) => row.user_id));
  const laterUsers = new Set(laterRows.map((row) => row.user_id));
  const overlappingUsers = Array.from(laterUsers).filter((userId) => originalUsers.has(userId)).length;
  const originalLastCreatedAt = originalWindow.at(-1)?.created_at || '无';
  const laterFirstCreatedAt = laterRows[0]?.created_at || '无';

  console.error(
    `按创建时间切分：最早 ${originalWindow.length} 条涉及 ${originalUsers.size} 位用户；其后 ${laterRows.length} 条涉及 ${laterUsers.size} 位用户，其中与早期用户重叠 ${overlappingUsers} 位。`
  );
  console.error(`时间切点：早期最后一条=${originalLastCreatedAt}；后续第一条=${laterFirstCreatedAt}`);

  if (laterRows.length > 0) {
    printDistribution('后续记录名称分布', buildDistribution(laterRows, getDisplayName));
    printDistribution(
      '后续记录品质分布',
      buildDistribution(laterRows, (row) => row.rarity)
    );
    printDistribution(
      '后续记录创建日期分布',
      buildDistribution(laterRows, (row) => getDateBucket(row.created_at))
    );
    printDistribution(
      '后续记录抽卡日期分布',
      buildDistribution(laterRows, (row) => getDateBucket(row.timestamp))
    );
    printDistribution(
      '后续记录区服范围分布',
      buildDistribution(laterRows, (row) => row.server_scope)
    );
    printDistribution(
      '后续记录卡池分布',
      buildDistribution(laterRows, (row) => row.pool_id)
    );
  }
}

function printSnapshotDiagnostics(rows) {
  console.error('以下为匿名只读诊断，不包含用户名、邮箱或访问凭证：');
  printDistribution('记录名称分布', buildDistribution(rows, getDisplayName));
  printDistribution(
    '角色名称字段分布',
    buildDistribution(rows, (row) => row.character_name)
  );
  printDistribution(
    '物品名称字段分布',
    buildDistribution(rows, (row) => row.item_name)
  );
  printDistribution(
    '品质分布',
    buildDistribution(rows, (row) => row.rarity)
  );
  printDistribution(
    '创建日期分布',
    buildDistribution(rows, (row) => getDateBucket(row.created_at))
  );
  printDistribution(
    '抽卡日期分布',
    buildDistribution(rows, (row) => getDateBucket(row.timestamp))
  );
  printDistribution(
    '区服范围分布',
    buildDistribution(rows, (row) => row.server_scope)
  );
  printDistribution(
    '卡池分布（最多 20 项）',
    buildDistribution(rows, (row) => row.pool_id)
  );
  printChronologicalDelta(rows);
}

function assertExpectedSnapshot(rows) {
  const userCount = new Set(rows.map((row) => row.user_id)).size;
  if (rows.length !== EXPECTED_RECORDS || userCount !== EXPECTED_USERS) {
    printSnapshotDiagnostics(rows);
    throw new Error(
      `安全检查未通过：当前识别到 ${rows.length} 条记录、${userCount} 位用户；预期为 ${EXPECTED_RECORDS} 条、${EXPECTED_USERS} 位用户。请重新调查后再执行。`
    );
  }

  const incomplete = rows.filter(
    (row) => !row.user_id || !row.game_uid || !row.server_scope || !row.pool_id || !row.seq_id
  );
  if (incomplete.length > 0) {
    throw new Error(`安全检查未通过：${incomplete.length} 条记录缺少账号、区服、卡池或序号，无法建立精确异常标记。`);
  }

  const unexpectedPattern = rows.filter(
    (row) =>
      row.character_id !== null ||
      !isUnknownName(row.character_name) ||
      !isUnknownName(row.item_name) ||
      Number(row.rarity) !== 4 ||
      !EXPECTED_POOL_IDS.has(String(row.pool_id))
  );
  if (unexpectedPattern.length > 0) {
    printSnapshotDiagnostics(unexpectedPattern);
    throw new Error(`安全检查未通过：${unexpectedPattern.length} 条记录不符合已核实的旧导入异常模式。`);
  }

  return userCount;
}

function buildAnomalyRow(row) {
  const itemName = getDisplayName(row) || '未知';
  return {
    user_id: row.user_id,
    record_id: String(row.record_id),
    game_uid: String(row.game_uid),
    server_scope: String(row.server_scope),
    pool_id: String(row.pool_id),
    seq_id: String(row.seq_id),
    issue_code: ISSUE_CODE,
    status: 'pending',
    details: {
      message: '旧版官方导入没有识别到这条记录的角色或武器，请确认它是否属于你。',
      itemName,
      rarity: row.rarity ?? null,
      timestamp: row.timestamp ?? null,
      pity: row.pity ?? null,
      serverId: row.server_id ?? null,
      region: row.region ?? null,
      legacyRecordId: String(row.record_id),
    },
  };
}

async function insertAnomalyMarkers(client, rows) {
  let insertedOrExisting = 0;
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200).map(buildAnomalyRow);
    const { error } = await client.from('history_anomalies').upsert(batch, {
      onConflict: 'user_id,game_uid,server_scope,pool_id,seq_id,issue_code',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    insertedOrExisting += batch.length;
  }
  return insertedOrExisting;
}

async function verifyAnomalyMarkers(client, rows) {
  const markers = await runCandidateQuery(
    '已写入的旧导入异常标记',
    client
      .from('history_anomalies')
      .select('user_id, game_uid, server_scope, pool_id, seq_id, status')
      .eq('issue_code', ISSUE_CODE)
  );
  const markerKeys = new Set(markers.map(getHistoryScopeKey));
  const missingKeys = rows.map(getHistoryScopeKey).filter((key) => !markerKeys.has(key));

  if (missingKeys.length > 0) {
    throw new Error(`写入核验失败：${missingKeys.length} 条候选记录没有对应的异常标记。`);
  }

  const statusSummary = buildDistribution(markers, (row) => row.status)
    .map(([status, count]) => `${status}=${count}`)
    .join('，');
  console.log(
    `写入核验通过：本次 ${rows.length} 条候选均已有标记；当前同类标记共 ${markers.length} 条（${statusSummary || '无'}）。`
  );
}

async function main() {
  const { url, key } = getSupabaseConfig();
  console.log('开始核对旧版官方导入异常快照；当前不会写入数据库。');
  const client = createClient(url, key, {
    global: { fetch: createTimedFetch() },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const candidates = await loadNullCharacterHistory(client);
  const anomalies = candidates.filter(isUnknownHistoryRow);
  if (anomalies.length !== candidates.length) {
    const excludedCandidates = candidates.filter((row) => !isUnknownHistoryRow(row));
    printSnapshotDiagnostics(excludedCandidates);
    throw new Error(`安全检查未通过：${excludedCandidates.length} 条候选记录的角色名称与物品名称不同时为未知值。`);
  }
  const userCount = assertExpectedSnapshot(anomalies);

  console.log(`安全检查通过：识别到 ${anomalies.length} 条旧导入异常，涉及 ${userCount} 位用户。`);

  const shouldApply = process.argv.includes('--apply');
  if (!shouldApply) {
    console.log('当前为演练模式：只检查数量，不写入数据库。需要执行时请追加 --apply。');
    return;
  }
  if (process.env.CONFIRM_HISTORY_ANOMALY_BACKFILL !== APPLY_CONFIRMATION) {
    throw new Error(`执行写入前必须设置 CONFIRM_HISTORY_ANOMALY_BACKFILL=${APPLY_CONFIRMATION}`);
  }

  const processed = await insertAnomalyMarkers(client, anomalies);
  console.log(`异常标记写入完成：处理 ${processed} 条；已有标记不会被覆盖或重新打开。`);
  await verifyAnomalyMarkers(client, anomalies);
}

main().catch((error) => {
  console.error(`异常标记回填失败：${error.message}`);
  process.exitCode = 1;
});
