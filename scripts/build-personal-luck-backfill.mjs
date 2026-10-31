import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/run-personal-luck-backfill.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: '.agent-tmp/personal-luck-backfill.mjs',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
