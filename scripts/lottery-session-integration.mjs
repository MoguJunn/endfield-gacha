import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function applyLotterySessionIntegration(rootDir, lotteryRoot) {
  await copyFile(resolve(rootDir, 'shared/lotterySiteUrls.js'), resolve(lotteryRoot, 'api/_lib/requestSiteUrls.js'));
  const routerPath = resolve(lotteryRoot, 'api/router.js');
  let router = await readFile(routerPath, 'utf8');
  if (!router.includes("import { resolveLotterySiteUrls }")) {
    const target = '  return config;\n}';
    if (!router.includes(target) || !router.includes('function requireRuntime(res) {')) throw new Error('lottery_session_runtime_target_missing');
    router = `import { resolveLotterySiteUrls } from './_lib/requestSiteUrls.js';\n${router}`;
    router = router.replaceAll('requireRuntime(res)', 'requireRuntime(res, req)');
    router = router.replace(target, '  return { ...config, ...resolveLotterySiteUrls(req) };\n}');
    await writeFile(routerPath, router, 'utf8');
  }
  const httpPath = resolve(lotteryRoot, 'api/_lib/http.js');
  let http = await readFile(httpPath, 'utf8');
  if (!http.includes("import { resolveLotterySiteUrls }")) {
    const target = 'origin === getRuntimeConfig(env).lotteryOrigin';
    if (!http.includes(target)) throw new Error('lottery_session_origin_target_missing');
    http = http.replace("import { getRuntimeConfig } from './env.js';", "import { resolveLotterySiteUrls } from './requestSiteUrls.js';");
    http = http.replace(target, 'origin === resolveLotterySiteUrls(req, env).lotteryOrigin');
    await writeFile(httpPath, http, 'utf8');
  }
}
