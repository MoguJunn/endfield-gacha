import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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

await build({
  root: lotteryRoot,
  configFile: resolve(lotteryRoot, 'vite.config.js'),
  base: '/lottery/',
  build: {
    outDir: resolve(rootDir, 'dist', 'lottery'),
    emptyOutDir: false,
  },
});
