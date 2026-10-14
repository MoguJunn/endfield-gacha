import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildPersonalAnalysisSnapshots } from '../src/utils/personalAnalysisSnapshot.js';
import { createWorkbenchPreviewApi } from './workbenchPreviewApi.mjs';
import { createRevisionPreviewApi } from './lib/workbenchRevisionPreviewApi.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const realAccount = process.argv.includes('--real-account');
const revisions = process.argv.includes('--revisions');
const sourceIndex = process.argv.indexOf('--source-url');
let sourceSnapshot;
if (sourceIndex >= 0) {
  const source = new URL(process.argv[sourceIndex + 1]);
  if (!['127.0.0.1', 'localhost'].includes(source.hostname)) throw new Error('仅可复用本机真实预览的数据');
  const response = await fetch(new URL('/__workbench-initial', source), { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || !data.preview?.realAccount) throw new Error('本机来源不是有效的真实账号预览');
  sourceSnapshot = { ownerId: 'workbench-account-local-preview', pools: data.pools, entities: data.entities,
    history: data.history, accounts: data.owner.accounts.filter(account => !account.gameUid?.startsWith('DEMO-')),
    fetchedAt: data.preview.fetchedAt };
}
const snapshot = sourceSnapshot || (realAccount ? await (await import('../../_tmp/data-workbench/scripts/load-workbench-account.mjs')).loadWorkbenchAccount()
  : JSON.parse(await readFile(new URL('../../_demos/workbench-feedback/snapshot.json', import.meta.url), 'utf8')));
if (!realAccount && (snapshot.ownerId !== 'workbench-feedback-demo' || !snapshot.accounts.every(account => account.gameUid.startsWith('DEMO-ACCOUNT')))) {
  throw new Error('整合预览仅使用已有脱敏快照');
}
const ownerId = realAccount ? 'workbench-account-local-preview' : 'workbench-feedback-demo';
const pools = snapshot.pools.map(pool => ({ ...pool, pool_id: pool.id }));
const history = snapshot.history.map(row => ({ ...row, user_id: ownerId, game_uid: row.gameUid,
  server_scope: row.serverScope, server_id: row.serverScope, pool_id: row.poolId,
  character_id: row.characterId, record_id: row.record_id || row.id }));
const revisionApi = revisions ? await createRevisionPreviewApi(snapshot) : null;
const previewApi = revisionApi?.handle || createWorkbenchPreviewApi({ pools, entities: snapshot.entities, initialHistory: history });
const port = Number(process.env.WORKBENCH_INTEGRATION_PORT) || (realAccount ? 5187 : 5186);
const buildModel = async () => {
  const current = revisionApi ? await revisionApi.readModel() : { history, entries: [] };
  const currentHistory = current.history.map(row => ({ ...row, user_id: ownerId }));
  const model = buildPersonalAnalysisSnapshots({ userId: ownerId, pools, history: currentHistory,
    characters: snapshot.entities, workbenchEntries: current.entries.map(row => ({ ...row, user_id: ownerId })),
    statisticsExclusions: (current.exclusions || []).map(row => ({ ...row, user_id: ownerId })) });
  if (!model.owner.accounts.some(account => account.gameUid === 'DEMO-EMPTY')) model.owner.accounts.push({
    accountKey: 'DEMO-EMPTY@1', gameUid: 'DEMO-EMPTY', serverScope: '1', serverId: '1', nickName: '空白账号 · 试用首次导入', total: 0 });
  return { model, history: currentHistory };
};
const plugin = {
  name: 'workbench-main-local-preview',
  enforce: 'pre',
  transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/hooks/app/useAppInitialization.js')) return `
      import { useEffect } from 'react';
      import { useAuthStore, useHistoryStore, usePoolStore, usePersonalDataStore, usePersonalAnalysisStore } from '../../stores';
      import { characterCache } from '../../utils/characterUtils.js';
      export function useAppInitialization() {
        useEffect(() => { let active = true; fetch('/__workbench-initial').then(r => r.json()).then(data => {
          if (!active) return;
          characterCache.applyCharacters(data.entities); characterCache.finishLoading();
          usePersonalDataStore.setState({ ownerId: '${ownerId}', phase: 'ready', hasSnapshot: true, publicPools: data.pools });
          usePoolStore.getState().setPools(data.pools);
          usePoolStore.setState({ currentPoolId: data.pools.find(pool => pool.name === '冬猎')?.id,
            currentGameUid: data.owner.accounts[0]?.gameUid });
          useHistoryStore.getState().setHistory(data.history);
          usePersonalAnalysisStore.setState({ availability: 'ready', owner: data.owner, scope: data.scope, meta: { ownerId: '${ownerId}' } });
          useAuthStore.setState({ user: { id: '${ownerId}', email: 'preview@example.invalid' }, userRole: 'user', authResolved: true });
        }); return () => { active = false; }; }, []);
      }
      export default useAppInitialization;`;
    if (id.replaceAll('\\', '/').endsWith('/src/supabaseClient.js')) return 'export const supabase = null; export const isSupabaseRealtimeEnabled = () => false; export const isSupabaseConfigured = () => false;';
    if (id.replaceAll('\\', '/').endsWith('/src/main.jsx')) return code.replace('{!isContributorDemoModeEnabled() && <Analytics />}', '').replace('{!isContributorDemoModeEnabled() && <SpeedInsights />}', '');
    if (id.replaceAll('\\', '/').endsWith('/src/features/data-workbench/DataWorkbenchPage.jsx')) return code.replace('questionnaireReadDelayMs = 15000', 'questionnaireReadDelayMs = 0');
    return null;
  },
  transformIndexHtml() {
    return [{ tag: 'script', children: "localStorage.setItem('lastCaptchaVerified',Date.now());", injectTo: 'head-prepend' },
      { tag: 'aside', attrs: { style: 'padding:8px 16px;background:#fefce8;color:#854d0e;font:12px var(--font-sans);text-align:center;' },
        children: `${realAccount ? '真实账号本机预览' : '本机测试预览'} · 修改不会写入线上，重启后恢复初始数据`, injectTo: 'body-prepend' }];
  },
  configureServer(vite) {
    return () => vite.middlewares.stack.unshift({ route: '', handle: async (req, res, next) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const json = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
      if (url.pathname === '/__workbench-initial') {
        const current = await buildModel();
        return json(200, { pools, history: current.history, entities: snapshot.entities, owner: current.model.owner,
          scope: current.model.scopes[0]?.payload, preview: { realAccount, revisions, fetchedAt: snapshot.fetchedAt } });
      }
      if (url.pathname === '/__workbench-stop' && req.method === 'POST' && req.headers.origin === `http://127.0.0.1:${port}`) {
        json(200, { success: true });
        setTimeout(async () => { await server.close(); await revisionApi?.close(); process.exit(0); }, 100);
        return;
      }
      if (await previewApi(req, url, json)) return;
      if (url.pathname === '/api/bootstrap') return json(200, { success: true, data: { pools, siteConfig: { site_name: '终末地抽卡分析', site_version: '主站整合预览' } } });
      if (url.pathname === '/api/account-gacha-data') {
        if (req.method !== 'GET') return json(403, { success: false, error: '请在导入／修改页试用本机保存' });
        const { model, history: currentHistory } = await buildModel();
        if (url.searchParams.get('mode') === 'analysis') {
          const scope = model.scopes.find(item => item.scopeKey === url.searchParams.get('accountKey')) || model.scopes[0];
          return json(200, { success: true, availability: 'ready', schemaVersion: 1, owner: model.owner, scope: scope?.payload,
            source: 'local-integration-preview', meta: { ownerId, accountKey: scope?.scopeKey, rawIncluded: false } });
        }
        return json(200, { success: true, history: currentHistory, meta: { ownerId } });
      }
      if (url.pathname === '/api/pool-rosters') return json(200, { success: true, data: {
        rosters: Object.fromEntries(pools.map(pool => [pool.id, pool.rosterEntityIds.map(id => ({ pool_id: pool.id, character_id: id,
          is_up: pool.rosterUpEntityIds?.includes(id), characters: snapshot.entities.find(entity => entity.id === id) }))])) } });
      if (url.pathname === '/api/stats') {
        const type = url.searchParams.get('type');
        const { model } = await buildModel();
        return json(200, { success: true, data: type === 'characters' ? { characters: snapshot.entities }
          : type === 'pools' ? { pools } : type === 'pool_counts' ? { counts: {} } : { totalPulls: model.owner.summary.total, pools, accounts: model.owner.accounts } });
      }
      if (url.pathname.startsWith('/api/')) return json(200, { success: true, data: [], profile: { role: 'user' }, config: {}, unreadCount: 0 });
      // The preview cannot make production API or authentication requests.
      res.setHeader('Content-Security-Policy', `connect-src 'self' ws://127.0.0.1:${port}; form-action 'none'`);
      next();
    } });
  },
};
const server = await createServer({ root, configFile: `${root}vite.config.js`, plugins: [plugin],
  server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close(); await revisionApi?.close(); process.exit(0);
});
console.log(`主站整合预览：http://127.0.0.1:${port}/data-workbench`);
console.log(`手机布局：http://127.0.0.1:${port}/m/data-workbench`);
console.log(`使用 ${snapshot.accounts.length} 个${realAccount ? '真实测试账号' : '脱敏账号'}、${history.length} 条历史；保存${revisions ? '和撤回仅写入本机临时 PostgreSQL' : '仅在本机内存生效'}。`);
