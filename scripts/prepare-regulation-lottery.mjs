import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REGULATION_LOTTERY, createRegulationSiteConfig, getRegulationPublicEnvironment } from '../shared/regulationLottery.js';

const root = resolve(import.meta.dirname, '..');
const archive = JSON.parse(await readFile(resolve(root, 'src/assets/lottery/archives/arknights-p3r-collab-2026.json'), 'utf8'));
const site = createRegulationSiteConfig(archive.data.site);
const output = resolve(root, process.argv[2] || '.agent-tmp/regulation-release');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'public-env.json'), JSON.stringify(getRegulationPublicEnvironment(site), null, 2));
await writeFile(resolve(output, 'campaign.json'), JSON.stringify({
  id: REGULATION_LOTTERY.id,
  title: REGULATION_LOTTERY.title,
  closesAt: REGULATION_LOTTERY.closesAt,
  drawsAt: REGULATION_LOTTERY.drawsAt,
  prizePlan: REGULATION_LOTTERY.prizePlan,
  startsAt: null,
  status: 'scheduled',
  publicRandomnessChain: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicRandomnessRound: Math.ceil((Date.parse(REGULATION_LOTTERY.drawsAt) / 1000 - 1692803367) / 3) + 1,
}, null, 2));
console.log(`已生成本地活动配置：${output}。未连接数据库或部署平台；正式开放前需设置开始时间及新的种子承诺。`);
