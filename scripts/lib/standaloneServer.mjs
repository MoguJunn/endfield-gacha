import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.otf': 'font/otf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };

function responseAdapter(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = value => {
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return res.json(value);
    res.end(value);
    return res;
  };
  res.redirect = (code, location) => {
    if (location === undefined) { location = code; code = 302; }
    res.statusCode = code;
    res.setHeader('Location', location);
    res.end();
    return res;
  };
  return res;
}

async function readBody(req, limit) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return {};
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  req.rawBody = raw;
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  if (type === 'application/json' || type.endsWith('+json')) {
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  return raw;
}

async function serveStatic(req, res, root, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { return res.status(400).end(); }
  if (relative.includes('\0') || relative.split(/[\\/]/).some(part => part.startsWith('.') && part !== '')) {
    return res.status(404).end();
  }
  let file = path.resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(root + path.sep)) return res.status(404).end();
  let info;
  try { info = await stat(file); } catch { /* SPA paths are resolved below. */ }
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    try { info = await stat(file); } catch { info = null; }
  }
  if (!info?.isFile()) {
    if (path.extname(relative)) return res.status(404).end();
    file = path.join(root, relative.startsWith('/lottery') ? 'lottery/index.html' : 'index.html');
    try { info = await stat(file); } catch { return res.status(404).end(); }
  }
  const actual = await realpath(file);
  const actualRoot = await realpath(root);
  if (!actual.startsWith(actualRoot + path.sep)) return res.status(404).end();
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Length', info.size);
  const immutable = /\/assets\//.test(relative) && !relative.startsWith('/m/assets/legacy-');
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(file), res);
}

export function createStandaloneServer({ handler, staticRoot, version = 'unknown', bodyLimit = 16 * 1024 * 1024 }) {
  const root = path.resolve(staticRoot);
  const server = http.createServer(async (req, rawRes) => {
    const res = responseAdapter(rawRes);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') {
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ ok: true, version });
      }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        req.query = Object.fromEntries(url.searchParams);
        req.body = await readBody(req, bodyLimit);
        return await handler(req, res);
      }
      return await serveStatic(req, res, root, url.pathname);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.status(error.status || 500).json({ success: false,
        error: error.status ? error.message : 'Internal server error' });
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
