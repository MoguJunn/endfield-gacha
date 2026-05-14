import assert from 'node:assert/strict';

import { __internal, handleOfficialAnnouncementsFeed as handler } from '../api/_routes/root/automation-feed.js';
import {
  __internal as gameBulletinInternal,
  buildGameBulletinSourceRecords,
} from '../api/_lib/gameBulletinFeed.js';
import {
  __internal as presentationInternal,
  buildAnnouncementDisplayContent,
} from '../api/_lib/officialAnnouncementPresentation.js';
import { __internal as syncAnnouncementsInternal } from '../api/_lib/syncAnnouncements.js';
import { __internal as runOpsAutomationInternal } from '../api/_lib/runOpsAutomation.js';
import { __internal as digestInternal, refreshGameAnnouncementDigest } from '../api/_lib/gameAnnouncementDigest.js';
import { getDefaultRunnableJobIds } from '../api/_lib/opsAutomation.js';

function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end(payload = null) {
      this.payload = payload;
      return this;
    },
  };
}

assert.equal(
  __internal.buildOfficialArticleUrl('5992'),
  'https://endfield.hypergryph.com/news/5992',
  '官方公告原文链接应可直接构造',
);
assert.match(
  gameBulletinInternal.buildAggregateUrl(),
  /code=endfield_5SD9TN/,
  '游戏内公告聚合接口必须携带游戏内 bulletin code',
);
assert.doesNotMatch(
  gameBulletinInternal.buildAggregateUrl(),
  /u8_token/,
  '游戏内公告聚合接口不得依赖玩家 u8_token',
);
{
  const gameBulletinRecords = await buildGameBulletinSourceRecords(2, {
    fetchImpl: async (url) => {
      const normalizedUrl = String(url);
      assert.match(normalizedUrl, /bulletin\/v2\/aggregate/, '游戏内公告应优先读取聚合接口');
      assert.doesNotMatch(normalizedUrl, /u8_token/, '游戏内公告请求不得包含玩家 token');
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            list: [
              {
                cid: '8966',
                tab: 'events',
                displayType: 'rich_text',
                startAt: 1776380400,
                title: '春雷动，万物生\\n特许寻访',
                header: '「春雷动，万物生」特许寻访',
                data: {
                  html: '<p>「春雷动，万物生」特许寻访中，6星干员【庄方宜】获取概率提升。</p>',
                },
                version: 1776247175,
              },
              {
                cid: '2106',
                tab: 'news',
                displayType: 'picture',
                startAt: 1776744000,
                title: '春晓时系列\\n衍生品现已开售',
                data: {
                  url: 'https://web.hycdn.cn/upload/image/test.jpg',
                  link: 'https://example.com/product',
                },
                version: 1776655284,
              },
            ],
          },
        }),
      };
    },
  });

  assert.equal(gameBulletinRecords.length, 2, '游戏内公告应同时标准化 rich_text 与 picture 公告');
  assert.equal(gameBulletinRecords[0].source_id, 'game-bulletin:8966', '游戏内公告 source_id 应带来源前缀，避免与官网 cid 冲突');
  assert.equal(gameBulletinRecords[0].title, '「春雷动，万物生」特许寻访', '游戏内公告标题应优先使用 header');
  assert.match(gameBulletinRecords[0].raw_content, /庄方宜/, 'rich_text 公告应保留正文 HTML');
  assert.match(gameBulletinRecords[1].raw_content, /<img/, 'picture 公告应转换为可展示图片 HTML');
  assert.match(gameBulletinRecords[1].raw_content, /查看详情/, 'picture 公告应保留跳转链接');
}
{
  const preferredRecords = await __internal.buildPreferredAnnouncementSourceRecords(1, {
    fetchImpl: async (url) => {
      const normalizedUrl = String(url);
      if (normalizedUrl.includes('game-hub.hypergryph.com')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [
                {
                  cid: '8966',
                  tab: 'events',
                  displayType: 'rich_text',
                  startAt: 1776380400,
                  title: '春雷动，万物生\\n特许寻访',
                  header: '「春雷动，万物生」特许寻访',
                  data: { html: '<p>游戏内公告正文</p>' },
                  version: 1776247175,
                },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected fallback URL: ${url}`);
    },
  });
  assert.equal(preferredRecords[0].source_id, 'game-bulletin:8966', '默认公告源应优先使用游戏内公告');
}
{
  const fallbackRecords = await __internal.buildPreferredAnnouncementSourceRecords(1, {
    fetchImpl: async (url) => {
      const normalizedUrl = String(url);
      if (normalizedUrl.includes('game-hub.hypergryph.com')) {
        return {
          ok: true,
          json: async () => ({ code: 1500, msg: 'Info not found', data: {} }),
        };
      }
      if (normalizedUrl.includes('/bulletin?')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [{ cid: '5992', title: '官网公告', displayTime: 1773203400, brief: '摘要' }],
            },
          }),
        };
      }
      if (normalizedUrl.includes('/bulletin/5992?')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              cid: '5992',
              title: '官网公告',
              displayTime: 1773203400,
              brief: '摘要',
              data: '<p>官网公告正文</p>',
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  assert.equal(fallbackRecords[0].source_id, '5992', '游戏内公告失败时应回退官网公告源');
}

const runnableJobs = getDefaultRunnableJobIds({}, {
  baseUrl: 'https://example.com',
});
assert.deepEqual(
  runnableJobs,
  ['official-announcements', 'pool-schedule', 'wiki-catalog'],
  '默认可运行任务应包含已接好的公告、卡池与图鉴 feed',
);

const completeStructuredSummary = [
  '> 以下为站内整理版摘要，细节以官方原文为准。',
  '',
  '## 核心内容',
  '- 第一条重点',
  '',
  '## 重要时间',
  '- 03/12 维护结束后开启',
  '',
  '## 影响与建议',
  '- 留意活动时间和卡池信息',
].join('\n');
const modernStructuredSummary = [
  '> 以下为站内整理版摘要，细节以官方原文为准。',
  '',
  '## 摘要',
  '本次公告说明「春晓时」版本相关活动安排，重点覆盖参与方式、奖励范围与活动时间，玩家可按官方原文确认具体平台规则。',
  '',
  '## 要点',
  '- 活动面向多个社区平台开放，主要鼓励创作、直播、讨论和互动参与。',
  '- 奖励包含平台激励、现金奖励、游戏道具和周边实物，具体条件以对应平台页面为准。',
  '',
  '## 时间',
  '- 各平台活动时间不同，需要以官方原文和平台活动页公布为准。',
].join('\n');
const truncatedStructuredSummary = [
  '> 以下为站内整理版摘要，细节以官方原文为准。',
  '',
  '## 核心内容',
  '- 第一条重点',
  '',
  '## 活动奖励',
].join('\n');
const repetitiveStructuredSummary = [
  '> 以下为站内整理版摘要，细节以官方原文为准。',
  '',
  '## 核心内容',
  '- 管理员，《明日方舟：终末地》「春晓时」版本创作征集活动正在多个社区平台进行中。按对应要求进行内容创作与分享即可参与奖励。',
  '',
  '## 重要时间',
  '- 管理员，《明日方舟：终末地》「春晓时」版本创作征集活动正在多个社区平台进行中。按对应要求进行内容创作与分享即可参与奖励。',
  '',
  '## 影响与建议',
  '- 管理员，《明日方舟：终末地》「春晓时」版本创作征集活动正在多个社区平台进行中。按对应要求进行内容创作与分享即可参与奖励。',
].join('\n');

assert.equal(
  presentationInternal.isStructuredSummaryComplete(completeStructuredSummary),
  true,
  '完整 LLM 摘要应通过结构校验',
);
assert.equal(
  presentationInternal.isStructuredSummaryComplete(modernStructuredSummary),
  true,
  '新的短简报 LLM 摘要应通过结构校验',
);
assert.equal(
  presentationInternal.isStructuredSummaryComplete(truncatedStructuredSummary),
  false,
  '被截断或偏离固定结构的 LLM 摘要不应被写入公告内容',
);
assert.equal(
  presentationInternal.isStructuredSummaryComplete(repetitiveStructuredSummary),
  false,
  '重复复读原文或保留原始称呼的 LLM 摘要不应被写入公告内容',
);
assert.deepEqual(
  presentationInternal.parseAnnouncementLlmRateLimit('50 requests / 5 minutes'),
  { maxCalls: 50, windowMs: 5 * 60 * 1000 },
  '公告 LLM 限流配置应支持每窗口请求数写法',
);
assert.deepEqual(
  presentationInternal.parseAnnouncementLlmRateLimit('10RPM'),
  { maxCalls: 10, windowMs: 60 * 1000 },
  '公告 LLM 限流配置应支持 RPM 写法',
);
{
  const llmConfig = await presentationInternal.loadAnnouncementLlmConfig({
    ANNOUNCEMENT_LLM_API_KEY: 'test-announcement-llm-key',
    ANNOUNCEMENT_LLM_BASE_URL: 'https://llm.example.com/v1',
    ANNOUNCEMENT_LLM_MODEL: 'announcement-model',
    ANNOUNCEMENT_LLM_RATE_LIMIT: '12RPM',
  });
  assert.deepEqual(
    {
      hasApiKey: Boolean(llmConfig.apiKey),
      model: llmConfig.model,
      url: llmConfig.url,
      rateLimit: llmConfig.rateLimit,
    },
    {
      hasApiKey: true,
      model: 'announcement-model',
      url: 'https://llm.example.com/v1/chat/completions',
      rateLimit: { maxCalls: 12, windowMs: 60 * 1000 },
    },
    '公告 LLM env 应解析出 key、chat completions URL、模型名与 RPM 限流',
  );
}
assert.equal(
  syncAnnouncementsInternal.isAnnouncementRecordChanged(
    { source_id: 'notice-1', title: '旧公告', content: '坏摘要', summary: '旧摘要', version: 'v1', published_at: '2026-04-29T00:00:00.000Z', source_url: 'https://example.com', is_active: true, priority: -100 },
    { source_id: 'notice-1', title: '旧公告', content: '完整摘要', summary: '旧摘要', version: 'v1', published_at: '2026-04-29T00:00:00.000Z', source_url: 'https://example.com', is_active: true, priority: -100 },
  ),
  true,
  '官方公告内容变化时同步任务应更新既有记录',
);
assert.equal(
  syncAnnouncementsInternal.shouldRefreshAnnouncementRecord(
    { source_id: 'notice-1', version: 'v1', content: '已有摘要' },
    { source_id: 'notice-1', version: 'v1' },
    { forceRefresh: false },
  ),
  false,
  '增量同步不应重算同版本且已有内容的公告',
);
assert.equal(
  syncAnnouncementsInternal.shouldRefreshAnnouncementRecord(
    { source_id: 'notice-1', version: 'v1', content: '' },
    { source_id: 'notice-1', version: 'v1' },
    { forceRefresh: false },
  ),
  true,
  '增量同步应修复同版本但内容为空的公告',
);
assert.equal(
  syncAnnouncementsInternal.shouldRefreshAnnouncementRecord(
    { source_id: 'notice-1', version: 'v1', content: '已有摘要' },
    { source_id: 'notice-1', version: 'v1' },
    { refreshMode: 'summary' },
  ),
  false,
  '强制刷新摘要只应重算需要总结的长公告',
);
assert.equal(
  syncAnnouncementsInternal.shouldRefreshAnnouncementRecord(
    { source_id: 'notice-1', version: 'v1', content: '已有摘要' },
    { source_id: 'notice-1', title: '版本更新说明', version: 'v1', raw_content: '长公告正文'.repeat(260) },
    { refreshMode: 'summary' },
  ),
  true,
  '强制刷新摘要应重算需要总结的长公告',
);
assert.equal(
  syncAnnouncementsInternal.shouldRefreshAnnouncementRecord(
    { source_id: 'notice-1', version: 'v1', content: '已有摘要' },
    { source_id: 'notice-1', version: 'v1' },
    { refreshMode: 'all' },
  ),
  true,
  '强制刷新全部公告应覆盖同版本公告',
);
assert.ok(
  syncAnnouncementsInternal.GAME_ANNOUNCEMENT_PRIORITY >= 0
    && syncAnnouncementsInternal.GAME_ANNOUNCEMENT_PRIORITY <= 100,
  '写入 announcements 的游戏公告 priority 必须满足数据库约束',
);
{
  const persistedRecord = syncAnnouncementsInternal.normalizePersistedAnnouncementRecord({
    title: '超长标题'.repeat(30),
    summary: '摘要',
    content: '超长正文'.repeat(2000),
    version: 'hg-1773203400-very-long-source-id',
  });
  assert.ok(
    persistedRecord.title.length <= syncAnnouncementsInternal.ANNOUNCEMENT_TITLE_MAX_LENGTH,
    '写入 announcements 的游戏公告 title 必须满足数据库长度约束',
  );
  assert.ok(
    persistedRecord.content.length <= syncAnnouncementsInternal.ANNOUNCEMENT_CONTENT_MAX_LENGTH,
    '写入 announcements 的游戏公告 content 必须满足数据库长度约束',
  );
  assert.ok(
    persistedRecord.version.length <= syncAnnouncementsInternal.ANNOUNCEMENT_VERSION_MAX_LENGTH,
    '写入 announcements 的游戏公告 version 必须满足数据库长度约束',
  );
}
assert.deepEqual(
  runOpsAutomationInternal.sanitizeResponseResults({
    announcements: {
      synced: 1,
      records: [{ source_id: '5992' }],
      rawRecords: [{ source_id: '5992' }],
      updatedRecords: [{ source_id: '5992' }],
    },
  }),
  { announcements: { synced: 1 } },
  '自动化接口响应不应把公告原始记录数组回传给管理页',
);
assert.equal(
  syncAnnouncementsInternal.normalizeAnnouncementRefreshMode({ forceRefresh: true }),
  'summary',
  '旧 forceRefresh=true 应兼容映射为强制刷新摘要',
);
assert.equal(
  syncAnnouncementsInternal.normalizeAnnouncementRefreshMode({ refreshMode: 'all' }),
  'all',
  '强制刷新全部公告应使用 all 模式',
);
assert.equal(
  syncAnnouncementsInternal.normalizeAnnouncementRefreshLimit('20'),
  20,
  '强制刷新全部公告应允许指定抓取条数',
);
assert.equal(
  syncAnnouncementsInternal.normalizeAnnouncementRefreshLimit('999'),
  syncAnnouncementsInternal.MAX_REFRESH_PAGE_SIZE,
  '强制刷新全部公告条数应有上限，避免一次性触发过多 LLM 调用',
);
assert.equal(
  syncAnnouncementsInternal.normalizeAnnouncementRefreshLimit('0'),
  syncAnnouncementsInternal.MIN_REFRESH_PAGE_SIZE,
  '强制刷新全部公告条数应有下限',
);
{
  const observedHeaders = [];
  const partialRecords = await __internal.buildOfficialAnnouncementSourceRecords(2, {
    fetchImpl: async (url, options = {}) => {
      observedHeaders.push(options.headers || {});
      const normalizedUrl = String(url);
      if (normalizedUrl.includes('/bulletin?')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [
                { cid: 'ok-1', title: '可用公告', displayTime: 1773203400, brief: '摘要' },
                { cid: 'bad-1', title: '失败公告', displayTime: 1773203401, brief: '摘要' },
              ],
            },
          }),
        };
      }

      if (normalizedUrl.includes('/bulletin/bad-1?')) {
        throw new Error('detail fetch failed');
      }

      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            cid: 'ok-1',
            title: '可用公告',
            displayTime: 1773203400,
            brief: '摘要',
            data: '<p>短公告正文</p>',
          },
        }),
      };
    },
  });
  assert.equal(partialRecords.length, 1, '单条公告详情失败不应中断整批公告同步');
  assert.ok(
    observedHeaders.every(headers => String(headers?.Referer || '').includes('endfield.hypergryph.com')),
    '官方公告抓取应携带官网 Referer，降低生产环境被源站拒绝的概率',
  );
}
{
  const operations = [];
  const fallbackRecords = await syncAnnouncementsInternal.loadExistingAnnouncementSourceRecords({
    from(table) {
      operations.push(['from', table]);
      return {
        select(columns) {
          operations.push(['select', columns]);
          return this;
        },
        eq(column, value) {
          operations.push(['eq', column, value]);
          return this;
        },
        not(column, operator, value) {
          operations.push(['not', column, operator, value]);
          return this;
        },
        order(column, options) {
          operations.push(['order', column, options?.ascending]);
          return this;
        },
        limit(value) {
          operations.push(['limit', value]);
          return Promise.resolve({
            data: [
              {
                id: 'db-1',
                source_id: '9343',
                title: '「春晓时」版本更新说明',
                summary: '已有摘要',
                content: '<p>数据库正文</p>',
                version: 'hg-db',
                published_at: '2026-04-17T05:00:00.000Z',
                source_url: 'https://endfield.hypergryph.com/news/9343',
                is_active: true,
              },
            ],
            error: null,
          });
        },
      };
    },
  }, 5);
  assert.equal(fallbackRecords.length, 1, '源站抓取失败时应可从数据库现有游戏公告回退');
  assert.equal(fallbackRecords[0].raw_content, '<p>数据库正文</p>', '数据库回退记录应保留可重算正文');
  assert.deepEqual(
    operations.filter(([name]) => name === 'not')[0],
    ['not', 'source_id', 'is', null],
    '数据库回退只应读取游戏公告，不应混入站点公告',
  );
}
{
  const calls = [];
  const mockSupabase = {
    from(table) {
      calls.push(['from', table]);
      return {
        insert(record) {
          calls.push(['insert', record.source_id]);
          return Promise.resolve({ error: null });
        },
        update(record) {
          calls.push(['update', record.source_id]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert() {
          throw new Error('upsert must not be used for announcement sync');
        },
      };
    },
  };

  await syncAnnouncementsInternal.persistAnnouncementRecord(
    mockSupabase,
    { source_id: '5992', title: '公告' },
    false,
  );
  await syncAnnouncementsInternal.persistAnnouncementRecord(
    mockSupabase,
    { source_id: '5992', title: '公告' },
    true,
  );

  assert.deepEqual(
    calls,
    [
      ['from', 'announcements'],
      ['insert', '5992'],
      ['from', 'announcements'],
      ['update', '5992'],
      ['eq', 'source_id', '5992'],
    ],
    '公告同步应使用 insert/update 兼容缺失 source_id 唯一索引的线上库',
  );
}

const truncatedLlmPresentation = await buildAnnouncementDisplayContent({
  title: '「春晓时」版本创作征集活动',
  summary: '',
  rawHtml: `<p>${'活动内容奖励时间说明'.repeat(260)}</p>`,
  sourceUrl: 'https://endfield.hypergryph.com/news/9999',
  publishedAt: '2026-04-29T00:00:00.000Z',
  env: {
    ANNOUNCEMENT_LLM_API_KEY: 'test-announcement-llm-key',
    ANNOUNCEMENT_LLM_BASE_URL: 'https://x666.me/',
    ANNOUNCEMENT_LLM_MODEL: 'gemini-flash-latest',
  },
  allowLlm: true,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: truncatedStructuredSummary,
          },
        },
      ],
    }),
  }),
});

assert.equal(
  truncatedLlmPresentation.summaryMode,
  'heuristic',
  '上游 length 截断时应回退到启发式完整摘要',
);
assert.match(
  truncatedLlmPresentation.content,
  /## 要点/,
  '截断回退内容仍应包含完整短简报小节',
);
assert.doesNotMatch(
  truncatedLlmPresentation.content,
  /[…]|\.{3}/u,
  '截断回退内容不应再使用省略号硬截断',
);
{
  let llmCallCount = 0;
  const cacheProbeOptions = {
    title: '缓存命中长公告',
    summary: '缓存摘要',
    rawHtml: `<p>${'缓存测试正文'.repeat(260)}</p>`,
    sourceUrl: 'https://endfield.hypergryph.com/news/cache-probe',
    publishedAt: '2026-05-05T00:00:00.000Z',
    env: {
      ANNOUNCEMENT_LLM_API_KEY: 'test-announcement-llm-key',
      ANNOUNCEMENT_LLM_BASE_URL: 'https://llm-cache.example.com/',
      ANNOUNCEMENT_LLM_MODEL: 'announcement-cache-model',
    },
    allowLlm: true,
    allowHeuristicSummary: false,
    fetchImpl: async () => {
      llmCallCount += 1;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: completeStructuredSummary,
              },
            },
          ],
        }),
      };
    },
  };

  const firstCachedPresentation = await buildAnnouncementDisplayContent(cacheProbeOptions);
  const secondCachedPresentation = await buildAnnouncementDisplayContent(cacheProbeOptions);

  assert.equal(firstCachedPresentation.summaryMode, 'llm', '首次长公告应可使用 LLM 摘要');
  assert.equal(secondCachedPresentation.summaryMode, 'llm', '同一长公告第二次应复用 LLM 摘要缓存');
  assert.equal(llmCallCount, 1, '同一长公告重复构建不应重复消耗 LLM 调用');
}

const fetchBackup = globalThis.fetch;
const envBackup = {
  ANNOUNCEMENT_LLM_API_KEY: process.env.ANNOUNCEMENT_LLM_API_KEY,
  ANNOUNCEMENT_LLM_BASE_URL: process.env.ANNOUNCEMENT_LLM_BASE_URL,
  ANNOUNCEMENT_LLM_MODEL: process.env.ANNOUNCEMENT_LLM_MODEL,
  SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY,
  SILICONFLOW_MODEL: process.env.SILICONFLOW_MODEL,
};

process.env.ANNOUNCEMENT_LLM_API_KEY = 'test-announcement-llm-key';
process.env.ANNOUNCEMENT_LLM_BASE_URL = 'https://x666.me/';
process.env.ANNOUNCEMENT_LLM_MODEL = 'gemini-flash-latest';
delete process.env.SILICONFLOW_API_KEY;
delete process.env.SILICONFLOW_MODEL;

globalThis.fetch = async (url) => {
  const normalizedUrl = String(url);

  if (normalizedUrl.includes('/bulletin?')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        code: 0,
        data: {
          list: [
            {
              cid: '5992',
              tab: 'notices',
              title: '「河流的女儿」特许寻访说明',
              displayTime: 1773203400,
              brief: '亲爱的管理员：测试摘要',
            },
          ],
        },
      }),
    };
  }

  if (normalizedUrl.includes('/bulletin/5992?')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        code: 0,
        data: {
          cid: '5992',
          tab: 'notices',
          title: '「河流的女儿」特许寻访说明',
          displayTime: 1773203400,
          brief: '亲爱的管理员：测试摘要',
          data: `<p>这是很长的版本公告正文。</p><p>${'超长正文内容'.repeat(260)}</p><p><img src="/images/test-banner.png" alt="测试图片" /></p>`,
        },
      }),
    };
  }

  if (normalizedUrl === 'https://x666.me/v1/chat/completions') {
    throw new Error('Public official announcement feed must not call the LLM');
  }

  throw new Error(`Unexpected URL: ${normalizedUrl}`);
};

const req = {
  method: 'GET',
  url: '/api/automation-feed?job=official-announcements',
  headers: {},
};
const res = createMockResponse();
await handler(req, res);

assert.equal(res.statusCode, 200, 'official-announcements-feed 应返回 200');
assert.equal(res.payload?.success, true, 'official-announcements-feed 应返回 success=true');
assert.equal(res.payload?.records?.length, 1, 'official-announcements-feed 应输出标准化记录');
assert.equal(res.payload.records[0].source_id, '5992', '记录应保留官方 cid 作为 source_id');
assert.equal(res.payload.records[0].summary, '亲爱的管理员：测试摘要', '公告摘要应保留或派生为可展示短摘要');
assert.doesNotMatch(res.payload.records[0].content, /## 摘要/, '公共公告 feed 不应生成伪摘要');
assert.equal(res.payload.records[0].summary_mode, 'raw', '公共公告 feed 不应触发 LLM 或启发式总结，应保留原文');
assert.match(
  res.payload.records[0].raw_content,
  /\/api\/official-announcement-image\?url=https%3A%2F%2Fendfield\.hypergryph\.com%2Fimages%2Ftest-banner\.png/,
  '原始正文中的相对图片地址应被归一化并改写为站内代理地址'
);
assert.match(res.payload.records[0].version, /^hg-1773203400-5992$/, 'version 应可从官方时间戳构造');

{
  const digest = digestInternal.parseDigestJson(JSON.stringify({
    title: '近期公告速览',
    subtitle: '游戏内活动、更新修复与官网同步公告集中更新。',
  }));

  assert.equal(digest.title, '近期公告速览', 'LLM 聚合摘要应解析 JSON 标题');
  assert.equal(digest.mode, 'llm', 'LLM 聚合摘要成功时应标记 llm 模式');
}

{
  const cachedValue = {
    title: '此前生成标题',
    subtitle: '此前生成的公告聚合摘要应在空窗口内继续保留。',
    mode: 'llm',
    fingerprint: 'old-cache',
  };
  const operations = [];
  const mockSupabase = {
    from(table) {
      assert.equal(table, 'site_config', '公告聚合摘要应读取 site_config');
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { value: JSON.stringify(cachedValue) }, error: null }),
        upsert: async (row) => {
          operations.push(row);
          return { error: null };
        },
      };
    },
  };

  const refreshResult = await refreshGameAnnouncementDigest(mockSupabase, [], {
    now: Date.parse('2026-05-09T00:00:00.000Z'),
  });
  assert.equal(refreshResult.updated, false, '7-15 天内没有公告时不应覆盖已有聚合摘要');
  assert.equal(refreshResult.digest.title, cachedValue.title, '空窗口应保留之前生成的标题');
  assert.equal(operations.length, 0, '保留缓存时不应写入新的空摘要');
}

{
  const sourceRecords = [
    {
      source_id: 'game-bulletin:events:fest',
      source_group: 'game',
      source_category: 'events',
      title: '「辉光庆典」特殊寻访说明',
      summary: '莱万汀、洁尔佩塔、艾尔黛拉、别礼进入特殊寻访。',
      version: 'gb-test-fest',
      published_at: '2026-05-13T04:00:00.000Z',
      is_active: true,
    },
  ];
  let storedDigestValue = null;
  const upserts = [];
  const mockSupabase = {
    from(table) {
      assert.equal(table, 'site_config', '公告聚合摘要应读取 site_config');
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({
          data: storedDigestValue ? { value: storedDigestValue } : null,
          error: null,
        }),
        upsert: async (row) => {
          upserts.push(row);
          storedDigestValue = row.value;
          return { error: null };
        },
      };
    },
  };

  const fallbackResult = await refreshGameAnnouncementDigest(mockSupabase, sourceRecords, {
    now: Date.parse('2026-05-14T00:00:00.000Z'),
    fetchImpl: async () => {
      throw new Error('simulated digest llm outage');
    },
  });
  assert.equal(fallbackResult.mode, 'fallback', 'LLM 失败时应先写入 fallback 聚合摘要');
  assert.equal(upserts.length, 1, '首次 fallback 应写入缓存');

  let llmCallCount = 0;
  const retryResult = await refreshGameAnnouncementDigest(mockSupabase, sourceRecords, {
    now: Date.parse('2026-05-14T00:00:00.000Z'),
    fetchImpl: async (url) => {
      llmCallCount += 1;
      if (String(url) !== 'https://x666.me/v1/chat/completions') {
        throw new Error(`Unexpected LLM URL: ${url}`);
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                title: '辉光庆典寻访开放',
                subtitle: '特殊寻访与限时特卖同步上线，重点查看活动规则与领取时间。',
              }),
            },
          }],
        }),
      };
    },
  });

  assert.equal(llmCallCount, 1, '同 fingerprint 的 fallback 缓存不应阻止后续 LLM 重试');
  assert.equal(retryResult.updated, true, 'fallback 缓存被 LLM 摘要替换时应标记 updated=true');
  assert.equal(retryResult.mode, 'llm', '重试成功后应保存 LLM 聚合摘要');
  assert.equal(retryResult.digest.title, '辉光庆典寻访开放', '重试后应使用新的 LLM 标题');
  assert.equal(upserts.length, 2, '重试成功后应覆盖旧 fallback 聚合摘要');
}

const llmPresentation = await buildAnnouncementDisplayContent({
  title: '「河流的女儿」特许寻访说明',
  summary: '亲爱的管理员：测试摘要',
  rawHtml: `<p>这是很长的版本公告正文。</p><p>${'超长正文内容'.repeat(260)}</p>`,
  sourceUrl: 'https://endfield.hypergryph.com/news/5992',
  publishedAt: '2026-03-11T04:30:00.000Z',
  env: process.env,
  allowLlm: true,
  allowHeuristicSummary: false,
  fetchImpl: async (url) => {
    if (String(url) !== 'https://x666.me/v1/chat/completions') {
      throw new Error(`Unexpected LLM URL: ${url}`);
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [
          {
            message: {
              content: completeStructuredSummary,
            },
            finish_reason: 'stop',
          },
        ],
      }),
    };
  },
});

assert.equal(llmPresentation.summaryMode, 'llm', '受控同步路径显式 allowLlm=true 时仍可使用 LLM 摘要');
assert.match(
  llmPresentation.content,
  /以下为站内整理版摘要/,
  '禁用启发式摘要时，LLM 成功仍应保存带摘要标记的站内摘要',
);

const failedLlmPresentation = await buildAnnouncementDisplayContent({
  title: '「春晓时」版本创作征集活动',
  summary: '测试摘要',
  rawHtml: `<p>${'超长正文内容'.repeat(260)}</p>`,
  sourceUrl: 'https://endfield.hypergryph.com/news/7221',
  publishedAt: '2026-04-20T05:00:00.000Z',
  env: process.env,
  allowLlm: true,
  allowHeuristicSummary: false,
  fetchImpl: async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify({
      error: {
        message: 'invalid api key',
      },
    }),
  }),
});
assert.equal(
  failedLlmPresentation.summaryMode,
  'llm_failed',
  '受控同步路径中 LLM 失败必须显式标记，不能静默当作原文成功',
);
assert.match(
  failedLlmPresentation.summaryError,
  /401|Unauthorized|invalid api key/,
  'LLM 失败原因应保留给管理页执行记录排查',
);

globalThis.fetch = fetchBackup;
if (envBackup.ANNOUNCEMENT_LLM_API_KEY === undefined) {
  delete process.env.ANNOUNCEMENT_LLM_API_KEY;
} else {
  process.env.ANNOUNCEMENT_LLM_API_KEY = envBackup.ANNOUNCEMENT_LLM_API_KEY;
}
if (envBackup.ANNOUNCEMENT_LLM_BASE_URL === undefined) {
  delete process.env.ANNOUNCEMENT_LLM_BASE_URL;
} else {
  process.env.ANNOUNCEMENT_LLM_BASE_URL = envBackup.ANNOUNCEMENT_LLM_BASE_URL;
}
if (envBackup.ANNOUNCEMENT_LLM_MODEL === undefined) {
  delete process.env.ANNOUNCEMENT_LLM_MODEL;
} else {
  process.env.ANNOUNCEMENT_LLM_MODEL = envBackup.ANNOUNCEMENT_LLM_MODEL;
}
if (envBackup.SILICONFLOW_API_KEY === undefined) {
  delete process.env.SILICONFLOW_API_KEY;
} else {
  process.env.SILICONFLOW_API_KEY = envBackup.SILICONFLOW_API_KEY;
}
if (envBackup.SILICONFLOW_MODEL === undefined) {
  delete process.env.SILICONFLOW_MODEL;
} else {
  process.env.SILICONFLOW_MODEL = envBackup.SILICONFLOW_MODEL;
}

console.log('DATA-NEW-011 official announcements feed verification passed');
