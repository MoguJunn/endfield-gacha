import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const lotteryRoot = resolve(rootDir, 'node_modules', 'open-lottery');
const activityRoot = resolve(lotteryRoot, 'public', 'local-activity');
const archiveTargetDir = resolve(activityRoot, 'archives');
const fontTargetDir = resolve(activityRoot, 'fonts');
const fontSourceDir = resolve(rootDir, 'src', 'assets', 'fonts');
const lotteryAssetDir = resolve(rootDir, 'src', 'assets', 'lottery');

async function applyLotteryResultsRevisionOverride() {
  const appPath = resolve(lotteryRoot, 'src', 'App.jsx');
  const stylesPath = resolve(lotteryRoot, 'src', 'styles.css');
  const contractsPath = resolve(lotteryRoot, 'api', '_lib', 'contracts.js');
  let appSource = await readFile(appPath, 'utf8');

  if (!appSource.includes('publicInvalidatedWinners')) {
    const stateTarget = "  const [verification, setVerification] = useState(null);";
    const waitingTarget = `  if (snapshot?.campaign?.phase !== 'drawn') {
    return (
      <div className="waiting-result">
        <div className="waiting-result__icon"><Trophy /><Sparkles /></div>
        <div><h3>开奖后在这里公布结果</h3></div>
      </div>
    );
  }`;
    const winnersTarget = `      <div className="winner-list">
        {(snapshot.publicWinners || []).map((winner) => (`;
    if (![stateTarget, waitingTarget, winnersTarget].every((target) => appSource.includes(target))) {
      throw new Error('lottery_results_revision_override_target_missing');
    }

    appSource = appSource
      .replace(stateTarget, `${stateTarget}\n  const invalidatedWinners = snapshot?.publicInvalidatedWinners || [];`)
      .replace(waitingTarget, `  if (snapshot?.campaign?.phase !== 'drawn') {
    return (
      <div className="results-pane">
        <div className="winner-list">
          {invalidatedWinners.map((winner) => (
            <article className="is-invalidated" key={\`invalidated-\${winner.drawRevision}-\${winner.prizeTier}-\${winner.winnerOrder}\`}><Trophy /><span><small>{'原' + (site.prizes.find((prize) => prize.tier === winner.prizeTier)?.title || getPrizeName(winner.prizeTier)) + ' · 资格已取消'}</small><strong>{winner.displayName}</strong><em>{winner.outcomeReason}</em></span><code>{formatEntryNumber(winner.entryNumber, site.entryPrefix)}</code></article>
          ))}
          {!invalidatedWinners.length && <div className="waiting-result"><div className="waiting-result__icon"><Trophy /><Sparkles /></div><div><h3>开奖后在这里公布结果</h3></div></div>}
        </div>
        <aside className="verification-card"><ShieldCheck /><strong>活动已重新开放</strong><small>第一次开奖因奖品配置修正而作废；最终结果将在新截止时间后按新承诺与公共随机数完整重抽。</small></aside>
      </div>
    );
  }`)
      .replace(winnersTarget, `      <div className="winner-list">
        {invalidatedWinners.map((winner) => (
          <article className="is-invalidated" key={\`invalidated-\${winner.drawRevision}-\${winner.prizeTier}-\${winner.winnerOrder}\`}><Trophy /><span><small>{'原' + (site.prizes.find((prize) => prize.tier === winner.prizeTier)?.title || getPrizeName(winner.prizeTier)) + ' · 资格已取消'}</small><strong>{winner.displayName}</strong><em>{winner.outcomeReason}</em></span><code>{formatEntryNumber(winner.entryNumber, site.entryPrefix)}</code></article>
        ))}
        {(snapshot.publicWinners || []).map((winner) => (`);
    await writeFile(appPath, appSource, 'utf8');
  }

  let stylesSource = await readFile(stylesPath, 'utf8');
  if (!stylesSource.includes('.winner-list article.is-invalidated')) {
    stylesSource += `

/* Lottery result revision status */
.winner-list em { color: var(--orange); font-size: 9px; font-style: normal; font-weight: 700; }
.winner-list article.is-invalidated { border-color: color-mix(in srgb, var(--orange) 52%, var(--line)); background: color-mix(in srgb, var(--orange) 8%, var(--surface-soft)); }
.winner-list article.is-invalidated > svg, .winner-list article.is-invalidated small { color: var(--orange); }
.winner-list article.is-invalidated code { text-decoration: line-through; }
`;
    await writeFile(stylesPath, stylesSource, 'utf8');
  }

  let contractsSource = await readFile(contractsPath, 'utf8');
  if (!contractsSource.includes('publicInvalidatedWinners')) {
    const publicWinnersTarget = `  const publicWinners = Array.isArray(snapshot?.publicWinners)
    ? snapshot.publicWinners.slice(0, 1000).map((winner) => sanitizeWinner(winner)).filter(Boolean)
    : [];`;
    const responseTarget = `    publicWinners,
    publicCandidateIds,`;
    if (![publicWinnersTarget, responseTarget].every((target) => contractsSource.includes(target))) {
      throw new Error('lottery_snapshot_contract_override_target_missing');
    }
    contractsSource = contractsSource
      .replace(publicWinnersTarget, `${publicWinnersTarget}
  const publicInvalidatedWinners = Array.isArray(snapshot?.publicInvalidatedWinners)
    ? snapshot.publicInvalidatedWinners.slice(0, 1000).map((winner) => ({
      ...sanitizeWinner(winner),
      outcomeStatus: text(winner.outcomeStatus, 40),
      outcomeReason: text(winner.outcomeReason, 300),
      drawRevision: finiteNumber(winner.drawRevision),
      supersededAt: nullableText(winner.supersededAt, 80),
    })).filter(Boolean)
    : [];`)
      .replace(responseTarget, `    publicWinners,
    publicInvalidatedWinners,
    publicCandidateIds,`);
    await writeFile(contractsPath, contractsSource, 'utf8');
  }
}

const activityAssets = [
  ['summer-gift-package.png', 'summer-gift-package.png'],
  ['arknights-monthly-card.png', 'arknights-monthly-card.png'],
  ['endfield-monthly-card.png', 'endfield-monthly-card.png'],
];

const activityArchives = [
  ['community-lottery.json', 'community-lottery.json'],
];

const fonts = [
  ['harmony/HarmonyOS_Sans_Medium.woff2', 'HarmonyOS_Sans_Medium.woff2'],
  ['harmony/HarmonyOS_Sans_SC_Medium.woff2', 'HarmonyOS_Sans_SC_Medium.woff2'],
  ['harmony/HarmonyOS_Sans_Bold.woff2', 'HarmonyOS_Sans_Bold.woff2'],
  ['harmony/HarmonyOS_Sans_SC_Bold.woff2', 'HarmonyOS_Sans_SC_Bold.woff2'],
  ['novecento/Novecento-Wide-Bold.otf', 'Novecento-Wide-Bold.otf'],
  ['novecento/Novecento-Wide-Bold-Tabular.otf', 'Novecento-Wide-Bold-Tabular.otf'],
];

const fontStylesheet = `@font-face {
  font-family: 'Harmony Sans Lottery';
  src: url('./HarmonyOS_Sans_Medium.woff2') format('woff2');
  font-display: swap;
  font-style: normal;
  font-weight: 400 600;
  unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}

@font-face {
  font-family: 'Harmony Sans Lottery';
  src: url('./HarmonyOS_Sans_SC_Medium.woff2') format('woff2');
  font-display: swap;
  font-style: normal;
  font-weight: 400 600;
  unicode-range: U+2E80-2EFF, U+2F00-2FDF, U+3000-303F, U+3040-30FF, U+3100-312F, U+31A0-31BF, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
}

@font-face {
  font-family: 'Harmony Sans Lottery';
  src: url('./HarmonyOS_Sans_Bold.woff2') format('woff2');
  font-display: swap;
  font-style: normal;
  font-weight: 700 900;
  unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F;
}

@font-face {
  font-family: 'Harmony Sans Lottery';
  src: url('./HarmonyOS_Sans_SC_Bold.woff2') format('woff2');
  font-display: swap;
  font-style: normal;
  font-weight: 700 900;
  unicode-range: U+2E80-2EFF, U+2F00-2FDF, U+3000-303F, U+3040-30FF, U+3100-312F, U+31A0-31BF, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
}

@font-face {
  font-family: 'Novecento Digits Lottery';
  src: url('./Novecento-Wide-Bold.otf') format('opentype');
  font-display: swap;
  font-style: normal;
  font-weight: 700 900;
  unicode-range: U+0023, U+0025, U+002B-003A, U+00B1;
}

@font-face {
  font-family: 'Novecento Tabular Lottery';
  src: url('./Novecento-Wide-Bold-Tabular.otf') format('opentype');
  font-display: swap;
  font-style: normal;
  font-weight: 700 900;
  unicode-range: U+0023, U+0025, U+002B-003A, U+00B1;
}

:root {
  --font-sans: 'Harmony Sans Lottery', 'HarmonyOS Sans SC', 'HarmonyOS Sans', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
  --font-number: 'Novecento Digits Lottery', 'Harmony Sans Lottery', sans-serif;
  --font-countdown: 'Novecento Tabular Lottery', 'Novecento Digits Lottery', 'Harmony Sans Lottery', sans-serif;
}
`;

await Promise.all([
  mkdir(fontTargetDir, { recursive: true }),
  mkdir(archiveTargetDir, { recursive: true }),
]);
await Promise.all(activityAssets.map(([source, target]) => (
  copyFile(resolve(lotteryAssetDir, source), resolve(activityRoot, target))
)));
await Promise.all(activityArchives.map(([source, target]) => (
  copyFile(resolve(lotteryAssetDir, 'archives', source), resolve(archiveTargetDir, target))
)));
await Promise.all(fonts.map(([source, target]) => (
  copyFile(resolve(fontSourceDir, source), resolve(fontTargetDir, target))
)));
await writeFile(resolve(fontTargetDir, 'site-fonts.css'), fontStylesheet, 'utf8');
await applyLotteryResultsRevisionOverride();

await build({
  root: lotteryRoot,
  configFile: resolve(lotteryRoot, 'vite.config.js'),
  base: '/lottery/',
  build: {
    outDir: resolve(rootDir, 'dist', 'lottery'),
    emptyOutDir: false,
  },
});
