// Each sample starts a fresh Node process. OPTIONS loads the selected route
// without authenticating, reading production data, or performing mutations.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scenarios = {
  router: null,
  maintenance: '/api/maintenance',
  statistics: '/api/stats',
  account: '/api/account-gacha-data',
};

if (process.argv[2] === '--sample') {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage();
  const { default: handler } = await import('../api/router.js');
  const url = scenarios[process.argv[3]];
  if (url) {
    const res = { setHeader() {}, getHeader() {}, status() { return this; }, json() {}, end() {} };
    await handler({ method: 'OPTIONS', url, headers: {} }, res);
  }
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({ elapsedMs: performance.now() - started,
    cpuMs: (used.user + used.system) / 1000,
    heapMb: (process.memoryUsage().heapUsed - memory.heapUsed) / 1024 ** 2,
    rssMb: (process.memoryUsage().rss - memory.rss) / 1024 ** 2 }));
} else {
  for (const scenario of Object.keys(scenarios)) {
    const samples = [];
    for (let index = 0; index < 5; index++) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--sample', scenario], {
        cwd: root, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, NODE_ENV: 'production' },
      });
      if (child.status !== 0) throw new Error(child.stderr || `Sample exited with ${child.status}`);
      samples.push(JSON.parse(child.stdout.trim().split('\n').at(-1)));
    }
    const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[2];
    console.log(JSON.stringify({ scenario, runs: samples.length,
      median: Object.fromEntries(['elapsedMs', 'cpuMs', 'heapMb', 'rssMb']
        .map(key => [key, +median(key).toFixed(2)])) }));
  }
}
