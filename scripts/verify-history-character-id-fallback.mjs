import assert from 'node:assert/strict';

import { upsertHistory } from '../src/services/cloudWriteService.js';
import {
  serializeHistoryForUpsert,
  upsertHistoryRowsWithOptionalColumnFallback,
} from '../src/utils/cloudDataWriteRows.js';

const sourceRecord = {
  id: 1,
  poolId: 'special_1_0_1',
  rarity: 6,
  character_name: '测试角色',
  character_id: 'char_test_001',
  seqId: '1001',
  gameUid: '1000123456',
  serverId: '2',
  region: 'asia',
  timestamp: '2026-03-21T07:00:00.000Z',
};

const serializedRow = serializeHistoryForUpsert(sourceRecord, 'user_test');
assert.equal(serializedRow.character_id, 'char_test_001', '序列化时应保留 canonical character_id');
assert.equal(serializedRow.server_id, '2', '序列化时应保留 server_id');
assert.equal(serializedRow.region, 'intl', '序列化时应按大区归一化 region');

const historyCalls = [];
let historyAttempt = 0;

await upsertHistoryRowsWithOptionalColumnFallback([serializedRow], async (rows, onConflict) => {
  historyAttempt += 1;
  historyCalls.push({
    rows: rows.map(row => ({ ...row })),
    onConflict,
  });

  if (historyAttempt === 1) {
    return {
      data: null,
      error: { message: "Could not find the 'server_id' column of 'history' in the schema cache" },
    };
  }

  if (historyAttempt === 2) {
    return {
      data: null,
      error: { message: "Could not find the 'region' column of 'history' in the schema cache" },
    };
  }

  if (historyAttempt === 3) {
    return {
      data: null,
      error: { message: "Could not find the 'character_id' column of 'history' in the schema cache" },
    };
  }

  return { data: rows, error: null };
});

assert.equal(historyCalls.length, 4, 'history upsert 应在缺少多个 optional 列时逐步重试');
assert.equal(historyCalls[0].rows[0].character_id, 'char_test_001', '首次写入应保留 canonical character_id');
assert.equal(historyCalls[0].rows[0].server_id, '2', '首次写入应保留 server_id');
assert.equal(historyCalls[0].rows[0].region, 'intl', '首次写入应保留归一化后的 region');
assert.equal('server_id' in historyCalls[1].rows[0], false, 'server_id 缺列后应先去掉 server_id');
assert.equal('region' in historyCalls[1].rows[0], true, 'region 在下一轮前仍应保留');
assert.equal('region' in historyCalls[2].rows[0], false, 'region 缺列后应继续去掉 region');
assert.equal('character_id' in historyCalls[2].rows[0], true, 'character_id 在最后一轮前仍应保留');
assert.equal('character_id' in historyCalls[3].rows[0], false, 'fallback 最终应去掉 history.character_id');
assert.equal(historyCalls[3].onConflict, 'user_id,game_uid,pool_id,seq_id', 'fallback 应保留原有冲突键');

const fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  fetchCalls.push({ input, init });
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        success: true,
        saved: { pools: 0, history: 1 },
        skipped: { pools: 0, history: 0 },
      };
    },
  };
};

try {
  await upsertHistory(null, [sourceRecord], 'user_test');
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(fetchCalls.length, 1, 'cloudWriteService 应通过同源账号抽卡接口保存 history');
assert.equal(fetchCalls[0].input, '/api/account-gacha-data', 'history 保存应走同源账号抽卡接口');
assert.equal(fetchCalls[0].init.method, 'POST', 'history 保存应使用 POST');
const requestBody = JSON.parse(fetchCalls[0].init.body);
assert.equal(requestBody.history.length, 1, '请求体应包含一条 history');
assert.equal(requestBody.history[0].user_id, 'user_test', '同源接口载荷应补齐 user_id');
assert.equal(requestBody.history[0].character_id, 'char_test_001', '同源接口载荷应保留 character_id');
assert.equal(requestBody.history[0].serverId, '2', '同源接口载荷应保留 serverId');
assert.equal(requestBody.history[0].region, 'asia', '同源接口载荷应保留原始 region，由同源接口序列化入库');

console.log('DATA-NEW-008 history optional-column fallback verification passed');
