import { fileURLToPath } from 'node:url';
import path from 'node:path';
import handler from '../api/router.js';
import { createStandaloneServer } from './lib/standaloneServer.mjs';

const root = process.env.APP_ROOT || fileURLToPath(new URL('../', import.meta.url));
const host = process.env.APP_HOST || '127.0.0.1';
const port = Number(process.env.APP_PORT || 3180);
const server = createStandaloneServer({ handler, staticRoot: path.join(root, 'dist'),
  version: process.env.APP_RELEASE || 'development' });
server.listen(port, host, () => console.log(`Standalone site listening on ${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
});
