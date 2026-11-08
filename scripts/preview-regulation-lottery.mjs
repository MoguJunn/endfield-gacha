import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { REGULATION_LOTTERY, createRegulationSiteConfig } from '../shared/regulationLottery.js';

const root = resolve(import.meta.dirname, '..');
const archive = JSON.parse(await readFile(resolve(root, 'src/assets/lottery/archives/arknights-p3r-collab-2026.json'), 'utf8'));
const snapshot = {
  contractVersion: 1,
  campaign: {
    id: REGULATION_LOTTERY.id,
    title: REGULATION_LOTTERY.title,
    startsAt: REGULATION_LOTTERY.previewStartsAt,
    closesAt: REGULATION_LOTTERY.closesAt,
    drawsAt: REGULATION_LOTTERY.drawsAt,
    phase: 'preparing',
    prizePlan: REGULATION_LOTTERY.prizePlan,
    seedCommitment: null,
  },
  entryCount: 0,
  user: null,
  entry: null,
  ownWinner: null,
  publicWinners: [],
  publicInvalidatedWinners: [],
  publicCandidateIds: [],
  site: createRegulationSiteConfig(archive.data.site),
  mainSiteUrl: '/',
};

const server = await preview({
  root,
  configFile: false,
  envFile: false,
  build: { outDir: resolve(root, 'dist') },
  preview: { host: '127.0.0.1', port: 4177, strictPort: true },
  plugins: [{
    name: 'regulation-local-preview',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1:4177');
        if (/^\/lottery\/archive\/[^/]+\/?$/u.test(url.pathname)) {
          req.url = '/lottery/index.html';
          return next();
        }
        if (!url.pathname.startsWith('/api/')) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (url.pathname === '/api/lottery' && req.method === 'GET') {
          res.end(JSON.stringify({ success: true, data: snapshot }));
          return;
        }
        res.statusCode = 409;
        res.end(JSON.stringify({ success: false, error: { code: 'local_preview_only', message: '当前为本地页面预览，未开放真实登录、报名和开奖。' } }));
      });
    },
  }],
});
server.printUrls();
console.log('本地活动预览：http://127.0.0.1:4177/lottery/（不连接生产报名服务）');
