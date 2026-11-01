// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStandaloneServer } from '../../scripts/lib/standaloneServer.mjs';

let root, server, origin, handler;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'endfield-standalone-'));
  await mkdir(path.join(root, 'dist/assets'), { recursive: true });
  await writeFile(path.join(root, 'dist/index.html'), '<html>app</html>');
  await writeFile(path.join(root, 'dist/assets/app-hash.js'), 'export default 1');
  await writeFile(path.join(root, 'dist/.env'), 'must-not-serve');
  await writeFile(path.join(root, 'secret.txt'), 'must-not-serve');
  handler = vi.fn((req, res) => res.json({ query: req.query, body: req.body, raw: req.rawBody }));
  server = createStandaloneServer({ handler, staticRoot: path.join(root, 'dist'), bodyLimit: 128 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('standalone HTTP adapter', () => {
  it('passes JSON, query and raw body through to the existing handlers', async () => {
    const response = await fetch(origin + '/api/test?a=1', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: '{"test":true}' });
    expect(await response.json()).toEqual({ query: { a: '1' }, body: { test: true }, raw: '{"test":true}' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects malformed JSON and oversized bodies before dispatch', async () => {
    const bad = await fetch(origin + '/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
    const large = await fetch(origin + '/api/test', { method: 'POST', body: 'a'.repeat(129) });
    expect(large.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
  it('preserves multiple session cookies and redirects', async () => {
    handler.mockImplementation((req, res) => {
      res.setHeader('Set-Cookie', ['one=value; HttpOnly; Secure', 'two=value; HttpOnly; Secure']);
      return res.redirect(303, '/settings');
    });
    const response = await fetch(origin + '/api/test', { redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('location')).toBe('/settings');
  });
  it('serves SPA navigation and immutable assets, but never exposes server files', async () => {
    expect(await (await fetch(origin + '/m/details')).text()).toContain('app');
    const asset = await fetch(origin + '/assets/app-hash.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(origin + '/missing.js')).status).toBe(404);
    expect((await fetch(origin + '/.env')).status).toBe(404);
    expect((await fetch(origin + '/%2e%2e%2fsecret.txt')).status).toBe(404);
    const head = await fetch(origin + '/assets/app-hash.js', { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('16');
    expect(await head.text()).toBe('');
  });
  it('does not disclose internal failures or secrets in error responses', async () => {
    handler.mockRejectedValue(new Error('database-password=secret'));
    const response = await fetch(origin + '/api/test');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
