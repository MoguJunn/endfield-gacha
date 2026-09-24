/**
 * Verify the private server against the public request contract without importing
 * server.js (which starts listeners, timers and alerts).
 * Usage: node scripts/verify-official-gacha-server-contract.mjs /path/to/backend/server.js
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as contract from '../shared/officialGachaRecordTypes.js';

const serverPath = process.argv[2];
assert.ok(serverPath, '请提供待验证的私有 backend/server.js 路径');
const serverSource = await readFile(serverPath, 'utf8');
assert.match(serverSource, /import\s*\{[^}]*DEFAULT_OFFICIAL_RECORD_REQUESTS[^}]*\}\s*from ['"]\.\.\/shared\/officialGachaRecordTypes\.js['"]/);

function extractFunction(name) {
  const match = serverSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(match, `未找到后端函数 ${name}`);
  return match[0];
}

const functions = [
  'getFallbackOfficialImportPoolId', 'getOfficialImportPoolId', 'fetchRecordsInternal',
  'executeRecordsBatch', 'handleRecordsBatch', 'handleRecords', 'handleImportFull',
];
const requestedUrls = [];
const queueTasks = [];
const progressTasks = new Map();
const rerun = contract.OFFICIAL_CHARACTER_POOL_TYPES.RERUN;
const weaponRecords = [
  { poolId: 'opaque-weapon', seqId: '201', poolType: 'rerun', poolVersion: 2, weaponId: 'weapon-1' },
  { poolId: 'opaque-weapon', seqId: '200', poolType: 'standard', poolVersion: 3, weaponId: 'weapon-2' },
];
let completeImport;
let failImport;
const sandbox = {
  ...contract,
  console: { log() {}, warn() {}, error() {} },
  process: { env: {} },
  URLSearchParams, Set, Map,
  ALLOW_PARTIAL_ON_RISK: false,
  delay: async () => {},
  normalizeImportSource: source => source === 'intl' ? 'intl' : 'cn',
  normalizeFullImportMode: mode => mode === 'full' ? 'full' : 'incremental',
  getSourceConfig: source => ({
    recordsCharEndpoint: `https://${source === 'intl' ? 'ef-webview.gryphline.com' : 'ef-webview.hypergryph.com'}/api/record/char`,
    recordsWeaponEndpoint: `https://${source === 'intl' ? 'ef-webview.gryphline.com' : 'ef-webview.hypergryph.com'}/api/record/weapon`,
  }),
  createIncrementalImportStopGuard: () => ({ inspectPage: () => ({ shouldStop: false }), getMeta: () => ({}) }),
  checkRiskControl: () => false,
  looksLikeTokenInvalidError: () => false,
  appendSourceSelectionHint: message => message,
  dailyStats: { recordFetch() {}, recordError() {}, recordImportResult() {} },
  sendErrorAlert: async () => assert.fail('验证过程中不应触发告警'),
  globalRequestQueue: { startBatch() {}, endBatch() {} },
  globalImportTaskQueue: {
    enqueue(work, metadata) {
      const task = { taskId: 'queued-task', taskKey: 'test-key', position: 1, promise: work(), metadata };
      queueTasks.push(task);
      return task;
    },
  },
  sendJSON: (response, status, data) => Object.assign(response, { status, data }),
  httpsRequest: async url => {
    const parsed = new URL(url);
    requestedUrls.push(parsed);
    const isRerun = parsed.searchParams.get('pool_type') === rerun;
    const secondPage = parsed.searchParams.has('seq_id');
    const list = parsed.pathname === '/api/record/weapon' ? weaponRecords : isRerun
      ? [{ poolId: 'opaque-char', seqId: secondPage ? '100' : '101', poolVersion: secondPage ? 2 : 3, charId: 'char-1' }]
      : [];
    return { data: { code: 0, data: { list, hasMore: isRerun && !secondPage } } };
  },
  requireAuthenticatedUser: async () => ({ id: 'test-user' }),
  isSupabaseAdminEnabled: true,
  generateTaskId: () => 'full-task',
  importTasks: progressTasks,
  updateTaskProgress: (id, update) => {
    Object.assign(progressTasks.get(id), update);
    if (update.status === 'completed') completeImport(update.result);
    if (update.status === 'failed') failImport(new Error(update.error));
  },
  executeFullImport: async ({ authChainFunctions }) => authChainFunctions.fetchAllRecordsConcurrent('test-token', '2', 'test-game', 'test-account'),
};
vm.createContext(sandbox);
vm.runInContext(functions.map(extractFunction).join('\n\n'), sandbox, { timeout: 1000 });

assert.equal(contract.DEFAULT_OFFICIAL_RECORD_REQUESTS.length, 6);
const batchResponse = {};
await sandbox.handleRecordsBatch({ u8Token: 'test-token', pools: contract.DEFAULT_OFFICIAL_RECORD_REQUESTS }, batchResponse);
assert.equal(batchResponse.status, 202, '六组批量请求应成功入队');
const batch = await queueTasks.at(-1).promise;
assert.equal(batch.results.length, 6);
const rerunRecords = batch.results.find(result => result.poolType === rerun).records;
assert.equal(rerunRecords.length, 2);
assert.deepEqual(Array.from(rerunRecords, record => [record.poolId, record.poolVersion, record.sourcePoolType, record._poolType]), [
  ['opaque-char', 3, rerun, 'extra'], ['opaque-char', 2, rerun, 'extra'],
]);
assert.deepEqual(Array.from(batch.results.find(result => result.type === 'weapon').records, record => record._poolType), ['extra', 'limited_weapon']);
const rerunUrls = requestedUrls.filter(url => url.searchParams.get('pool_type') === rerun);
assert.deepEqual(rerunUrls.map(url => [url.pathname, url.searchParams.get('seq_id')]), [
  ['/api/record/char', null], ['/api/record/char', '101'],
]);
const rejected = {};
await sandbox.handleRecordsBatch({ u8Token: 'test-token', pools: [...contract.DEFAULT_OFFICIAL_RECORD_REQUESTS, { type: 'weapon' }] }, rejected);
assert.equal(rejected.status, 400);
assert.match(rejected.data.error, /Maximum 6/);

for (const source of ['cn', 'intl']) {
  const page = {};
  await sandbox.handleRecords({ u8Token: 'test-token', type: 'char', poolType: rerun, seqId: '101', serverId: '2', source }, page);
  assert.equal(page.status, 200);
  assert.equal(page.data.data.list[0].sourcePoolType, rerun);
  assert.equal(page.data.data.list[0].poolVersion, 2);
  const url = requestedUrls.at(-1);
  assert.equal(url.pathname, '/api/record/char');
  assert.equal(url.searchParams.get('server_id'), '2');
  assert.equal(url.searchParams.get('seq_id'), '101');
  assert.equal(url.hostname, source === 'intl' ? 'ef-webview.gryphline.com' : 'ef-webview.hypergryph.com');

  const completion = new Promise((resolve, reject) => { completeImport = resolve; failImport = reject; });
  const response = {};
  await sandbox.handleImportFull({}, { token: 'test-token', accountIndex: 0, userId: 'test-user', source }, response);
  assert.equal(response.status, 202);
  const result = await completion;
  assert.equal(queueTasks.at(-1).metadata.poolsCount, 6, '完整导入应提交共享六组契约');
  assert.equal(result.results.length, 6);
  assert.equal(result.totalRecords, 4);
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
console.log('通过：六组批量、七组拒绝、重构分页、国服/国际服单页与完整导入、来源类型及版本保留。');
console.log(`server.js SHA256 ${sha256(serverSource)}`);
console.log(`shared/officialGachaRecordTypes.js SHA256 ${sha256(await readFile(new URL('../shared/officialGachaRecordTypes.js', import.meta.url)))}`);
