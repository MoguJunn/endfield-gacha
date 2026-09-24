import { build } from 'esbuild';

// Build locally/CI; production needs only this artifact and the pinned Node
// image in endfield-statistics-docker.service. No credentials enter the bundle.
await build({
  entryPoints: ['scripts/run-statistics-worker.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: process.argv[2] || '.agent-tmp/statistics-worker.mjs',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
