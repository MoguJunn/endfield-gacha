import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createModuleRecoveryPlugin } from '../../../scripts/lib/moduleRecoveryPlugin.mjs';

const html = '<!doctype html><html><head><meta charset="UTF-8"><script type="module" src="/assets/index.js"></script></head></html>';
const bundle = {
  entry: { type: 'chunk', isEntry: true, fileName: 'assets/index.js' },
  page: { type: 'chunk', isEntry: false, fileName: 'assets/MobileHomePageView.js' },
  vendor: { type: 'chunk', isEntry: false, fileName: 'assets/vendor.js' },
  css: { type: 'asset', fileName: 'assets/app.css' },
};
const result = createModuleRecoveryPlugin().transformIndexHtml.handler(html, { bundle });

function runBootstrap(query) {
  const maps = [];
  vm.runInNewContext(result.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URL,
    location: { href: `https://example.com/m${query}` },
    document: { createElement: () => ({}), head: { appendChild: script => maps.push(script) } },
  });
  return maps;
}

describe('built module recovery', () => {
  it('keeps charset first and registers recovery before module requests', () => {
    expect(result.indexOf('charset')).toBeLessThan(1024);
    expect(result.indexOf('map.type')).toBeLessThan(result.indexOf('type="module"'));
  });
  it('leaves normal visits alone and rejects invalid recovery tokens', () => {
    expect(runBootstrap('')).toEqual([]);
    expect(runBootstrap('?__module_recover=invalid')).toEqual([]);
  });
  it('refreshes dependencies while keeping a single app entry and original CSS', () => {
    const [map] = runBootstrap('?__module_recover=123456789');
    expect(map.type).toBe('importmap');
    expect(JSON.parse(map.textContent).imports).toEqual({
      '/assets/MobileHomePageView.js': '/assets/MobileHomePageView.js?__module_recover=123456789',
      '/assets/vendor.js': '/assets/vendor.js?__module_recover=123456789',
    });
  });
});
