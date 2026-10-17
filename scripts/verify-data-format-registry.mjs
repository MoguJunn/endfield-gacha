import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

import {
  detectImportFormat,
  prepareImportPayload,
  listSupportedExportFormats,
  listSupportedImportFormats,
} from '../src/utils/dataFormatRegistry.js';
import { buildExportContent, buildExportPayload } from '../src/utils/dataExport.js';
import { getHistoryImportDedupKey, validateAndNormalizeImportData } from '../src/utils/dataImport.js';
import { parseImportFileContent } from '../src/utils/dataImportFileParser.js';

const currentPayload = {
  formatId: 'internal_json_v3',
  schemaVersion: '3.0.0',
  exportTime: '2026-03-21T08:00:00.000Z',
  pools: [
    { id: 'special_1_0_1', name: '限定测试池', type: 'limited' },
  ],
  history: [
    {
      id: 1001,
      poolId: 'special_1_0_1',
      name: '测试角色',
      rarity: 6,
      isStandard: false,
      timestamp: '2026-03-21T08:00:00.000Z',
    },
  ],
};

const legacyPayload = {
  pools: [
    { pool_id: 'special_1_0_1', name: '限定测试池', type: 'limited_character' },
  ],
  history: [
    {
      record_id: 1002,
      pool_id: 'special_1_0_1',
      item_name: '旧版角色',
      rarity: 5,
      is_standard: false,
      timestamp: '2026-03-21T08:01:00.000Z',
    },
  ],
};

const bhaooPayload = {
  schema_version: 1,
  updatedAt: '2026-05-09T08:00:00.000Z',
  account: {
    uid: 'hg-001',
    provider: 'hypergryph',
    roleId: {
      roleId: 'role-001',
      nickName: '测试账号',
      serverId: '1',
      serverName: '官服',
    },
  },
  character: {
    special_1_0_1: [
      {
        charId: 'char_001',
        charName: '测试角色',
        gachaTs: '1778260000',
        isFree: false,
        isNew: true,
        poolId: 'special_1_0_1',
        poolName: '限定测试池',
        rarity: 6,
        seqId: '9101',
      },
    ],
  },
  weapon: {
    weaponbox_1_0_1: [
      {
        weaponId: 'weapon_001',
        weaponName: '测试武器',
        weaponType: '剑',
        gachaTs: '1778260100000',
        isNew: false,
        poolId: 'weaponbox_1_0_1',
        poolName: '武器测试池',
        rarity: 5,
        seqId: '9102',
      },
    ],
  },
};

const helperPayload = {
  schemaVersion: 2,
  exportedAt: 1778260200000,
  accounts: [
    {
      uid: '1:role-002',
      hgUid: '88888888',
      provider: 'hypergryph',
      roleId: 'role-002',
      serverId: '1',
      channelName: '官服',
      roles: [
        {
          roleId: 'role-002',
          nickName: 'Helper账号',
          serverId: '1',
          serverName: '官服',
        },
      ],
      addedAt: 1778260000000,
    },
  ],
  records: [
    {
      recordUid: 'char-record-001',
      uid: '1:role-002',
      category: 'character',
      poolId: 'special_1_0_1',
      poolName: '限定测试池',
      charId: 'char_002',
      charName: 'Helper角色',
      rarity: 6,
      isNew: true,
      isFree: false,
      gachaTs: 1778260000,
      seqId: '9201',
      fetchedAt: 1778260010000,
    },
  ],
  weaponRecords: [
    {
      recordUid: 'weapon-record-001',
      uid: '1:role-002',
      category: 'weapon',
      poolId: 'weaponbox_1_0_1',
      poolName: '武器测试池',
      weaponId: 'weapon_002',
      weaponName: 'Helper武器',
      weaponType: '剑',
      rarity: 5,
      isNew: true,
      gachaTs: '1778260100000',
      seqId: '9202',
      fetchedAt: 1778260110000,
    },
  ],
};

const bhaooLocalPayload = {
  updatedAt: '2026-05-09T08:00:00.000Z',
  character: {
    special_1_0_1: [
      {
        charId: 'char_003',
        charName: '本地角色',
        gachaTs: '1778260300000',
        isFree: '0',
        isNew: '1',
        poolId: 'special_1_0_1',
        poolName: '限定测试池',
        rarity: 6,
        seqId: '9301',
      },
    ],
  },
};

const helperCsv = [
  '\uFEFFrecordUid,uid,category,poolId,poolName,itemId,itemName,itemType,rarity,isNew,isFree,gachaTs,seqId,fetchedAt',
  'csv-char-001,1:role-003,character,special_1_0_1,限定测试池,char_003,CSV角色,character,6,1,0,1778260300,9301,1778260310',
  'csv-weapon-001,1:role-003,weapon,weaponbox_1_0_1,武器测试池,weapon_003,CSV武器,weapon,5,0,1,1778260400000,9302,1778260410000',
].join('\n');

const endgachaVerifiedPayload = {
  info: {
    uid: '1545604131',
    channel: 'official',
    lang: 'zh-ch',
    export_time: '2026-05-11 22:40:03',
    export_timestamp: 1778510403320,
    export_app: 'endgacha',
    export_type: 'gacha',
    version: '1.0',
    verify: 'test-signature',
  },
  data: {
    '1769048189.004': {
      p: '启程寻访',
      pi: 'beginner',
      c: [
        ['秋栗', 3, 1, 0],
        ['大潘', 4, 1, 0],
        ['骏卫', 5, 1, 0],
      ],
      seq: '3',
    },
    '1769059719.34': {
      p: '熔铸申领',
      pi: 'weponbox_1_0_1',
      c: [
        ['逐鳞3.0', 4, 1, 0],
      ],
      seq: '4',
    },
  },
};

const endgachaPlainJsonPayload = endgachaVerifiedPayload.data;

const endgachaPlainTxt = [
  '1769048189.004,启程寻访,秋栗-3-1@大潘-4-1',
  '1769059719.34,熔铸申领,逐鳞3.0-4-1@O.B.J.尖峰-4-1@宏愿-5-1',
].join('\n');

const helperCsvPayload = await parseImportFileContent(helperCsv, {
  fileName: 'endfield-gacha-2026-05-09.csv',
});
const endgachaPlainTxtPayload = await parseImportFileContent(endgachaPlainTxt, {
  fileName: '导出数据.txt',
});

assert.equal(detectImportFormat(currentPayload)?.id, 'internal_json_v3', '当前导出格式应识别为 internal_json_v3');
assert.equal(detectImportFormat(legacyPayload)?.id, 'internal_json_legacy', '旧版 payload 应识别为 internal_json_legacy');
assert.equal(detectImportFormat(bhaooPayload)?.id, 'bhaoo_endfield_gacha_json', 'bhaoo/endfield-gacha WebDAV JSON 应被识别');
assert.equal(detectImportFormat(helperPayload)?.id, 'endfield_gacha_helper_json', 'EndfieldGachaHelper JSON 应被识别');
assert.equal(detectImportFormat(helperCsvPayload)?.id, 'endfield_gacha_helper_json', 'EndfieldGachaHelper CSV 应转换为可识别 payload');
assert.equal(detectImportFormat(endgachaVerifiedPayload)?.id, 'endgacha_kwer_top_verified_json', 'endgacha.kwer.top 校验 JSON 应被识别');
assert.equal(detectImportFormat(endgachaPlainJsonPayload)?.id, 'endgacha_kwer_top_plain_json', 'endgacha.kwer.top 纯寻访 JSON 应被识别');
assert.equal(detectImportFormat(endgachaPlainTxtPayload)?.id, 'endgacha_kwer_top_plain_txt', 'endgacha.kwer.top 纯寻访 TXT 应被识别');
assert.deepEqual(prepareImportPayload(currentPayload), currentPayload, '当前 JSON 预处理应保持 payload 不变');
assert.deepEqual(prepareImportPayload(legacyPayload), legacyPayload, '旧版 JSON 预处理应保持 payload 不变');
assert.ok(listSupportedImportFormats().some(format => format.id === 'internal_json_v3'), '应列出当前 JSON 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'internal_json_legacy'), '应列出旧版 JSON 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'bhaoo_endfield_gacha_json'), '应列出 bhaoo/endfield-gacha 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'bhaoo_endfield_gacha_xlsx'), '应列出 bhaoo/endfield-gacha Excel 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'endfield_gacha_helper_json'), '应列出 EndfieldGachaHelper 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'endgacha_kwer_top_verified_json'), '应列出 endgacha.kwer.top 校验 JSON 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'endgacha_kwer_top_plain_json'), '应列出 endgacha.kwer.top 纯寻访 JSON 导入格式');
assert.ok(listSupportedImportFormats().some(format => format.id === 'endgacha_kwer_top_plain_txt'), '应列出 endgacha.kwer.top 纯寻访 TXT 导入格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'bhaoo_endfield_gacha_userdata_zip'), '应列出 EndfieldGacha userData ZIP 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'endfield_gacha_helper_json'), '应列出 EndfieldGachaHelper 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'endfield_gacha_helper_csv'), '应列出 EndfieldGachaHelper CSV 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'endfield_gacha_helper_userdata_zip'), '应列出 EndfieldGachaHelper userdata ZIP 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'endgacha_kwer_top_plain_json'), '应列出 endgacha.kwer.top 纯寻访 JSON 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'endgacha_kwer_top_plain_txt'), '应列出 endgacha.kwer.top 纯寻访 TXT 导出格式');
assert.ok(listSupportedExportFormats().some(format => format.id === 'internal_csv_flat'), '应列出 CSV 导出格式');

const validation = validateAndNormalizeImportData(currentPayload);
assert.equal(validation.valid, true, '当前 JSON payload 应可通过校验');
assert.equal(validation.normalizedData.sourceFormatId, 'internal_json_v3', '校验结果应保留来源格式 ID');

const bhaooValidation = validateAndNormalizeImportData(bhaooPayload);
assert.equal(bhaooValidation.valid, true, 'bhaoo/endfield-gacha payload 应可通过校验');
assert.equal(bhaooValidation.normalizedData.sourceFormatId, 'bhaoo_endfield_gacha_json', 'bhaoo 来源格式 ID 应保留');
assert.equal(bhaooValidation.normalizedData.history.length, 2, 'bhaoo payload 应展开角色与武器记录');
assert.equal(bhaooValidation.normalizedData.history[0].gameUid, 'role-001', 'bhaoo 账号应映射到角色 UID');

const bhaooLocalValidation = validateAndNormalizeImportData(bhaooLocalPayload, {
  sourceFileName: '363879170_1545604131.json',
});
assert.equal(bhaooLocalValidation.valid, true, 'bhaoo 本地 gachaData JSON 应可通过文件名补齐账号后校验');
assert.equal(bhaooLocalValidation.stats.accountCount, 1, 'bhaoo 本地 JSON 应从文件名补齐账号数量');
assert.equal(bhaooLocalValidation.normalizedData.history[0].gameUid, '1545604131', 'bhaoo 本地 JSON 应从文件名补齐角色 UID');
assert.equal(bhaooLocalValidation.normalizedData.history[0].hgUid, '363879170', 'bhaoo 本地 JSON 应从文件名补齐鹰角账号 UID');

const helperValidation = validateAndNormalizeImportData(helperPayload);
assert.equal(helperValidation.valid, true, 'EndfieldGachaHelper payload 应可通过校验');
assert.equal(helperValidation.normalizedData.sourceFormatId, 'endfield_gacha_helper_json', 'Helper 来源格式 ID 应保留');
assert.equal(helperValidation.normalizedData.history.length, 2, 'Helper payload 应展开角色与武器记录');
assert.equal(helperValidation.normalizedData.pools.find(pool => pool.id === 'weaponbox_1_0_1')?.type, 'weapon', 'Helper 武器池应保留为 weapon');
assert.equal(helperValidation.normalizedData.accounts[0].gameUid, 'role-002', 'Helper JSON 账号 UID 应去除 server 前缀');
assert.equal(helperValidation.normalizedData.accounts[0].hgUid, '88888888', 'Helper JSON 账号应保留 hgUid');
assert.equal(helperValidation.normalizedData.history[0].gameUid, 'role-002', 'Helper JSON 记录 UID 应去除 server 前缀');

const helperCsvValidation = validateAndNormalizeImportData(helperCsvPayload);
assert.equal(helperCsvValidation.valid, true, 'EndfieldGachaHelper CSV payload 应可通过校验');
assert.equal(helperCsvValidation.normalizedData.history.length, 2, 'Helper CSV 应展开角色与武器记录');
assert.equal(helperCsvValidation.normalizedData.history[0].isNew, true, 'Helper CSV 应解析 isNew=1');
assert.equal(helperCsvValidation.normalizedData.history[1].isFree, true, 'Helper CSV 应解析 isFree=1');
assert.equal(helperCsvValidation.stats.accountCount, 1, 'Helper CSV 应从 uid 列补齐账号数量');
assert.equal(helperCsvValidation.normalizedData.accounts[0].gameUid, 'role-003', 'Helper CSV 账号 UID 应去除 server 前缀');
assert.equal(helperCsvValidation.normalizedData.history[0].gameUid, 'role-003', 'Helper CSV 记录 UID 应去除 server 前缀');

const endgachaVerifiedValidation = validateAndNormalizeImportData(endgachaVerifiedPayload);
assert.equal(endgachaVerifiedValidation.valid, true, 'endgacha.kwer.top 校验 JSON 应可通过校验');
assert.equal(endgachaVerifiedValidation.normalizedData.sourceFormatId, 'endgacha_kwer_top_verified_json', 'endgacha 校验 JSON 来源格式 ID 应保留');
assert.equal(endgachaVerifiedValidation.normalizedData.history.length, 4, 'endgacha 校验 JSON 应展开批次寻访记录');
assert.equal(endgachaVerifiedValidation.stats.accountCount, 1, 'endgacha 校验 JSON 应包含账号信息');
assert.equal(endgachaVerifiedValidation.normalizedData.accounts[0].gameUid, '1545604131', 'endgacha 校验 JSON 应读取 UID');
assert.equal(endgachaVerifiedValidation.normalizedData.history[0].timestamp, '2026-01-22T02:16:29.004Z', 'endgacha 小数秒时间戳应按秒解析');
assert.deepEqual(endgachaVerifiedValidation.normalizedData.history.map(record => record.seqId), ['1', '2', '3', '4'], 'endgacha 校验 JSON 应按批次 seq 还原单条寻访序号');
assert.equal(
  getHistoryImportDedupKey(endgachaVerifiedValidation.normalizedData.history[0]),
  getHistoryImportDedupKey({ gameUid: '1545604131', serverScope: '1', poolId: 'beginner', seqId: '1' }),
  'endgacha 校验 JSON 记录应与本站同区服/UID/卡池/seqId 记录使用相同去重键'
);
assert.equal(endgachaVerifiedValidation.normalizedData.history.find(record => record.name === '秋栗')?.rarity, 4, 'endgacha raw rarity=3 应映射为 4★');
assert.equal(endgachaVerifiedValidation.normalizedData.history.find(record => record.name === '大潘')?.rarity, 5, 'endgacha raw rarity=4 应映射为 5★');
assert.equal(endgachaVerifiedValidation.normalizedData.history.find(record => record.name === '骏卫')?.rarity, 6, 'endgacha raw rarity=5 应映射为 6★');
assert.equal(endgachaVerifiedValidation.normalizedData.pools.find(pool => pool.id === 'weponbox_1_0_1')?.type, 'weapon', 'endgacha 武器池应识别为 weapon');

const endgachaPlainJsonValidation = validateAndNormalizeImportData(endgachaPlainJsonPayload);
assert.equal(endgachaPlainJsonValidation.valid, true, 'endgacha.kwer.top 纯寻访 JSON 应可通过校验');
assert.equal(endgachaPlainJsonValidation.stats.accountCount, 0, 'endgacha 纯寻访 JSON 不应伪造账号');
assert.equal(endgachaPlainJsonValidation.normalizedData.accountInfoMissing, true, 'endgacha 纯寻访 JSON 应标记缺少用户信息');
assert.equal(endgachaPlainJsonValidation.normalizedData.history[0].gameUid, null, 'endgacha 纯寻访 JSON 记录应保持无 UID');

const endgachaPlainTxtValidation = validateAndNormalizeImportData(endgachaPlainTxtPayload);
assert.equal(endgachaPlainTxtValidation.valid, true, 'endgacha.kwer.top 纯寻访 TXT 应可通过校验');
assert.equal(endgachaPlainTxtValidation.normalizedData.sourceFormatId, 'endgacha_kwer_top_plain_txt', 'endgacha 纯寻访 TXT 来源格式 ID 应保留');
assert.equal(endgachaPlainTxtValidation.normalizedData.history.length, 5, 'endgacha 纯寻访 TXT 应展开所有寻访项');
assert.equal(endgachaPlainTxtValidation.stats.accountCount, 0, 'endgacha 纯寻访 TXT 不应伪造账号');
assert.equal(endgachaPlainTxtValidation.normalizedData.accountInfoMissing, true, 'endgacha 纯寻访 TXT 应标记缺少用户信息');
assert.equal(endgachaPlainTxtValidation.normalizedData.history.find(record => record.name === '宏愿')?.rarity, 6, 'endgacha TXT raw rarity=5 应映射为 6★');
assert.equal(endgachaPlainTxtValidation.normalizedData.pools.find(pool => pool.name === '熔铸申领')?.id, 'weponbox_1_0_1', 'endgacha TXT 应按已知卡池名映射官方 poolId');

assert.equal(getHistoryImportDedupKey({ seqId: '9001' }), 'seq:9001', '无账号记录应保持旧 seq 去重键');
assert.equal(getHistoryImportDedupKey({ seqId: '9001', gameUid: 'role-001' }), 'uid:role-001:seq:9001', '有账号记录应使用账号隔离 seq 去重键');

const exportPayload = buildExportPayload({
  history: [
    {
      ...currentPayload.history[0],
      gameUid: 'role-001',
      game_uid: 'role-001',
      hgUid: '363879170',
      hg_uid: '363879170',
      character_id: 'char_001',
      isNew: true,
      is_new: true,
    },
    {
      id: 1003,
      poolId: 'weaponbox_1_0_1',
      pool_id: 'weaponbox_1_0_1',
      name: '测试武器',
      item_name: '测试武器',
      character_id: 'weapon_001',
      rarity: 5,
      timestamp: '2026-03-21T08:02:00.000Z',
      gameUid: 'role-001',
      game_uid: 'role-001',
      hgUid: '363879170',
      hg_uid: '363879170',
    },
    {
      id: 1004,
      poolId: 'joint_1_2_2',
      pool_id: 'joint_1_2_2',
      name: '洁尔佩塔',
      item_name: '洁尔佩塔',
      character_id: 'chr_0013_aglina',
      rarity: 6,
      isStandard: false,
      is_standard: false,
      timestamp: '2026-05-14T08:00:00.000Z',
      gameUid: 'role-001',
      game_uid: 'role-001',
      hgUid: '363879170',
      hg_uid: '363879170',
    },
  ],
  pools: [
    ...currentPayload.pools,
    { id: 'weaponbox_1_0_1', name: '武器测试池', type: 'weapon' },
    { id: 'joint_1_2_2', name: '辉光庆典', type: 'extra' },
  ],
  currentPoolId: null,
  currentGameUid: null,
  currentUserId: null,
  options: {},
});
const jsonExport = await buildExportContent('internal_json_v3', exportPayload);
const csvExport = await buildExportContent('internal_csv_flat', exportPayload);
const bhaooUserDataExport = await buildExportContent('bhaoo_endfield_gacha_userdata_zip', exportPayload);
const helperExport = await buildExportContent('endfield_gacha_helper_json', exportPayload);
const helperCsvExport = await buildExportContent('endfield_gacha_helper_csv', exportPayload);
const helperUserDataExport = await buildExportContent('endfield_gacha_helper_userdata_zip', exportPayload);
const endgachaPlainJsonExport = await buildExportContent('endgacha_kwer_top_plain_json', exportPayload);
const endgachaPlainTxtExport = await buildExportContent('endgacha_kwer_top_plain_txt', exportPayload);

assert.equal(jsonExport.extension, 'json', 'JSON 导出应返回 json 扩展名');
assert.equal(csvExport.extension, 'csv', 'CSV 导出应返回 csv 扩展名');
assert.equal(bhaooUserDataExport.extension, 'zip', 'EndfieldGacha userData 导出应返回 zip 扩展名');
assert.ok(bhaooUserDataExport.fileName.startsWith('EndfieldGacha_userData_'), 'EndfieldGacha userData 导出文件名应包含软件兼容前缀');
assert.equal(helperExport.extension, 'endfieldgacha.json', 'Helper JSON 导出应返回 endfieldgacha.json 扩展名');
assert.equal(helperCsvExport.extension, 'csv', 'Helper CSV 导出应返回 csv 扩展名');
assert.equal(helperUserDataExport.extension, 'zip', 'Helper userdata 导出应返回 zip 扩展名');
assert.ok(helperUserDataExport.fileName.startsWith('EndfieldGachaHelper_userdata_'), 'Helper userdata 导出文件名应包含软件兼容前缀');
assert.equal(endgachaPlainJsonExport.extension, 'json', 'endgacha.kwer.top 纯寻访 JSON 导出应返回 json 扩展名');
assert.equal(endgachaPlainTxtExport.extension, 'txt', 'endgacha.kwer.top 纯寻访 TXT 导出应返回 txt 扩展名');
assert.ok(endgachaPlainJsonExport.fileName.startsWith('endgacha-kwer-top-export-'), 'endgacha.kwer.top 纯寻访 JSON 文件名应包含兼容前缀');
assert.ok(endgachaPlainTxtExport.fileName.startsWith('endgacha-kwer-top-export-'), 'endgacha.kwer.top 纯寻访 TXT 文件名应包含兼容前缀');
assert.ok(jsonExport.content.includes('"schemaVersion": "3.0.0"'), 'JSON 导出内容应包含 schemaVersion');
assert.ok(csvExport.content.startsWith('\uFEFFschema_version,'), 'CSV 导出内容应带 BOM 和表头');
const internalJsonExportData = JSON.parse(jsonExport.content);
assert.equal(internalJsonExportData.history.length, 3, 'JSON 导出应保留历史记录');
assert.equal(internalJsonExportData.history[0].id, 1001, 'JSON 导出应保留记录 ID');
assert.equal('seq_id' in internalJsonExportData.history[0], false, 'JSON 导出不应重复输出 snake_case seq_id');
assert.equal('batch_id' in internalJsonExportData.history[0], false, 'JSON 导出不应重复输出 snake_case batch_id');
assert.equal('character_name' in internalJsonExportData.history[0], false, 'JSON 导出不应重复输出 character_name');
assert.equal('user_id' in internalJsonExportData.history[0], false, 'JSON 导出不应输出内部 user_id');
assert.equal('user_id' in internalJsonExportData.pools[0], false, 'JSON 导出卡池不应输出内部 user_id');
assert.equal(validateAndNormalizeImportData(internalJsonExportData).valid, true, '精简后的 JSON 导出仍应可导入');
const endgachaPlainJsonExportData = JSON.parse(endgachaPlainJsonExport.content);
assert.equal(detectImportFormat(endgachaPlainJsonExportData)?.id, 'endgacha_kwer_top_plain_json', '导出的 endgacha.kwer.top 纯寻访 JSON 应可被识别');
const endgachaPlainJsonRoundtrip = validateAndNormalizeImportData(endgachaPlainJsonExportData);
assert.equal(endgachaPlainJsonRoundtrip.valid, true, '导出的 endgacha.kwer.top 纯寻访 JSON 应可重新导入');
assert.equal(endgachaPlainJsonRoundtrip.normalizedData.accountInfoMissing, true, '导出的 endgacha.kwer.top 纯寻访 JSON 应标记缺少账号信息');
assert.equal(endgachaPlainJsonRoundtrip.normalizedData.history.find(record => record.name === '测试角色')?.rarity, 6, 'endgacha.kwer.top JSON roundtrip 应保留 6★');
const endgachaPlainTxtExportData = await parseImportFileContent(endgachaPlainTxtExport.content, { fileName: 'endgacha-kwer-top-export.txt' });
assert.equal(detectImportFormat(endgachaPlainTxtExportData)?.id, 'endgacha_kwer_top_plain_txt', '导出的 endgacha.kwer.top 纯寻访 TXT 应可被识别');
const endgachaPlainTxtRoundtrip = validateAndNormalizeImportData(endgachaPlainTxtExportData);
assert.equal(endgachaPlainTxtRoundtrip.valid, true, '导出的 endgacha.kwer.top 纯寻访 TXT 应可重新导入');
assert.equal(endgachaPlainTxtRoundtrip.normalizedData.accountInfoMissing, true, '导出的 endgacha.kwer.top 纯寻访 TXT 应标记缺少账号信息');
assert.equal(endgachaPlainTxtRoundtrip.normalizedData.history.find(record => record.name === '测试角色')?.rarity, 6, 'endgacha.kwer.top TXT roundtrip 应保留 6★');
const helperExportData = JSON.parse(helperExport.content);
assert.equal(helperExportData.schemaVersion, 2, 'Helper JSON 导出应使用 schemaVersion 2');
assert.equal(helperExportData.records.length, 2, 'Helper JSON 导出应包含角色与附加寻访记录');
assert.equal(helperExportData.weaponRecords.length, 1, 'Helper JSON 导出应包含武器记录');
assert.match(helperExportData.records[0].uid, /^\d+:/, 'Helper JSON 导出 UID 应带服务器前缀');
assert.equal(helperExportData.accounts[0].hgUid, '363879170', 'Helper JSON 导出应包含同步所需 hgUid');
assert.ok(helperCsvExport.content.startsWith('\uFEFFrecordUid,uid,category'), 'Helper CSV 导出应使用 Helper 表头');
const userDataZipEntries = unzipSync(bhaooUserDataExport.content);
const decodeZipJson = (path) => JSON.parse(new TextDecoder('utf-8').decode(userDataZipEntries[path]));
const bhaooUserDataConfig = decodeZipJson('userData/config.json');
const bhaooPoolInfo = decodeZipJson('userData/gachaData/poolInfo.json');
const bhaooAccountFileName = Object.keys(userDataZipEntries).find(path => /^userData\/gachaData\/.+\.json$/.test(path) && !path.endsWith('/poolInfo.json'));
const bhaooAccountData = decodeZipJson(bhaooAccountFileName);
assert.equal(bhaooUserDataConfig.currentUser, bhaooUserDataConfig.users[0].key, 'EndfieldGacha userData config 应指向当前用户');
assert.equal(bhaooPoolInfo.length, 3, 'EndfieldGacha userData 应包含卡池信息');
assert.equal(bhaooAccountData.character.E_CharacterGachaPoolType_Special.length, 1, 'EndfieldGacha userData 应包含角色记录');
assert.equal(bhaooAccountData.character.E_CharacterGachaPoolType_Joint.length, 1, 'EndfieldGacha userData 应包含 Joint 附加寻访记录');
assert.equal(bhaooAccountData.weapon.weaponbox_1_0_1.length, 1, 'EndfieldGacha userData 应包含武器记录');
const helperUserDataZipEntries = unzipSync(helperUserDataExport.content);
const helperDbBytes = helperUserDataZipEntries['userdata/efgacha.db'];
assert.ok(helperDbBytes, 'Helper userdata ZIP 应包含 userdata/efgacha.db');
assert.equal(new TextDecoder('ascii').decode(helperDbBytes.slice(0, 15)), 'SQLite format 3', 'Helper userdata 应生成真实 SQLite 数据库');
const { default: initSqlJs } = await import('sql.js');
const SQL = await initSqlJs();
const helperDb = new SQL.Database(helperDbBytes);
const helperAccountRows = helperDb.exec('SELECT uid, hg_uid, provider FROM accounts ORDER BY uid')[0]?.values || [];
const helperCharRows = helperDb.exec('SELECT uid, pool_id, char_name FROM gacha_records ORDER BY record_uid')[0]?.values || [];
const helperWeaponRows = helperDb.exec('SELECT uid, pool_id, weapon_name FROM weapon_records ORDER BY record_uid')[0]?.values || [];
assert.equal(helperAccountRows.length, 1, 'Helper userdata 数据库应包含账号');
assert.equal(helperAccountRows[0][1], '363879170', 'Helper userdata 数据库账号应写入 hg_uid');
assert.equal(helperCharRows.length, 2, 'Helper userdata 数据库应包含角色与附加寻访记录');
assert.ok(helperCharRows.some((row) => row[1] === 'joint_1_2_2'), 'Helper userdata 数据库应保留 Joint poolId');
assert.equal(helperWeaponRows.length, 1, 'Helper userdata 数据库应包含武器记录');
helperDb.close();

console.log('FEAT-021 data format registry verification passed');
