import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, '.agent-tmp/standalone-release'));
await mkdir(path.join(target, 'scripts'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['scripts/serve-standalone.mjs'],
  outdir: path.join(target, 'scripts'), bundle: true, splitting: true, format: 'esm', platform: 'node',
  target: 'node24', outExtension: { '.js': '.mjs' }, chunkNames: '_chunks/[name]-[hash]',
  external: ['playwright', 'playwright-core', '@sparticuz/chromium'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
await cp(path.join(root, 'dist'), path.join(target, 'dist'), { recursive: true });
await cp(path.join(root, 'src/assets/fonts'), path.join(target, 'src/assets/fonts'), { recursive: true });
await cp(path.join(root, 'public'), path.join(target, 'public'), { recursive: true });
// Only the screenshot route needs an external runtime package. It uses the
// system Chromium in the self-hosted image, without the Vercel binary pack.
await cp(path.join(root, 'node_modules/playwright-core'), path.join(target, 'node_modules/playwright-core'), { recursive: true });
await writeFile(path.join(target, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
console.log('Standalone release prepared (no environment files included).');
