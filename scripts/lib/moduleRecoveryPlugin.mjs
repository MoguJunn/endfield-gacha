// WebKit can keep a failed module response across document reloads. During the
// single guarded recovery, map the complete built module graph to fresh URLs.
// Normal visits keep the original immutable asset URLs and caching behavior.
export function createModuleRecoveryPlugin() {
  return {
    name: 'module-load-recovery',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        // Keep the entry URL unique: generated chunks can import shared exports
        // from it, and mapping it would bootstrap the app a second time.
        const modules = Object.values(bundle).filter(file => file.type === 'chunk' && !file.isEntry)
          .map(file => `/${file.fileName}`);
        const script = `(() => {
  const token = new URL(location.href).searchParams.get('__module_recover');
  if (!token || !/^\\d{1,17}$/.test(token)) return;
  const imports = {};
  for (const path of ${JSON.stringify(modules)}) {
    imports[path] = path + '?__module_recover=' + token;
  }
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports });
  document.head.appendChild(map);
})();`;
        // The charset declaration must stay within the first 1024 HTML bytes.
        // Register the map immediately after it, before any module preloads.
        return html.replace(/<meta\s+charset=[^>]+>/i, match => `${match}\n<script>${script}</script>`);
      },
    },
  };
}
