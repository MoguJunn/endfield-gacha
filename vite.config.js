import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { getApiRouteEntries } from './api/_routes/index.js';

const LOCAL_SERVER_ENV_PREFERRED_KEYS = new Set([
  'QQBOT_POOL_PUSH_ENABLED',
  'QQBOT_POOL_PUSH_WEBHOOK_URL',
  'QQBOT_POOL_PUSH_WEBHOOK_SECRET',
  'QQBOT_POOL_PUSH_TIMEOUT_MS',
]);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function createVercelLikeResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };

  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };

  return res;
}

function normalizeRequestPath(url) {
  if (!url) {
    return '';
  }

  const pathname = new URL(url, 'http://localhost').pathname;
  if (!pathname || pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/, '');
}

function readQuery(url) {
  if (!url) {
    return {};
  }

  const searchParams = new URL(url, 'http://localhost').searchParams;
  return Object.fromEntries(searchParams.entries());
}

function createApiMiddleware(routeHandlers) {
  return async (req, res, next) => {
    const requestPath = normalizeRequestPath(req.url);
    const handler = routeHandlers.get(requestPath);
    const debugApi = process.env.DEBUG_VITE_API === '1';

    if (debugApi && requestPath.startsWith('/api/')) {
      console.log(`[dev-api] ${req.method || 'GET'} ${requestPath} -> ${handler ? 'handler' : 'next'}`);
    }

    if (!handler) {
      next();
      return;
    }

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        req.body = await readJsonBody(req);
      } else {
        req.body = {};
      }
      req.query = readQuery(req.url);

      await handler(req, createVercelLikeResponse(res));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          error: error?.message || 'Dev API handler failed',
        })
      );
    }
  };
}

function installMiddlewareFirst(server, middleware) {
  const stack = server?.middlewares?.stack;
  if (Array.isArray(stack)) {
    stack.unshift({
      route: '',
      handle: middleware,
    });
    return;
  }

  server.middlewares.use(middleware);
}

function createDevApiPlugin() {
  const routeHandlers = new Map(getApiRouteEntries());
  const middleware = createApiMiddleware(routeHandlers);

  return {
    name: 'dev-api-handlers',
    configureServer(server) {
      installMiddlewareFirst(server, middleware);
    },
    configurePreviewServer(server) {
      installMiddlewareFirst(server, middleware);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, process.cwd(), '');
  const backendEnv = loadEnv(mode, `${process.cwd()}/backend`, '');
  const env = {
    ...backendEnv,
    ...rootEnv,
  };

  Object.entries(env).forEach(([key, value]) => {
    if (LOCAL_SERVER_ENV_PREFERRED_KEYS.has(key) || typeof process.env[key] === 'undefined') {
      process.env[key] = value;
    }
  });

  return {
    // VITE_* is the normal public env namespace. These Supabase key names are
    // also safe to expose because they are publishable/anon browser keys.
    envPrefix: ['VITE_', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'PUBLISHABLE_KEY'],
    plugins: [react(), createDevApiPlugin()],
    // The app is deployed at the domain root, so generated asset and SW URLs
    // must stay absolute across nested SPA routes like /m/summary.
    base: '/',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replaceAll('\\', '/');
            if (normalizedId.includes('commonjsHelpers.js')) {
              return 'shared-vendor';
            }

            if (!normalizedId.includes('node_modules')) {
              return;
            }

            if (
              normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/react-router-dom/') ||
              normalizedId.includes('/node_modules/@remix-run/router/')
            ) {
              return 'react-vendor';
            }

            if (normalizedId.includes('@supabase/')) {
              return 'supabase-vendor';
            }

            if (normalizedId.includes('/node_modules/prismjs/')) {
              return 'markdown-highlighter-vendor';
            }

            if (
              normalizedId.includes('/node_modules/@uiw/') ||
              normalizedId.includes('/node_modules/rehype') ||
              normalizedId.includes('/node_modules/remark') ||
              normalizedId.includes('/node_modules/unified') ||
              normalizedId.includes('/node_modules/micromark') ||
              normalizedId.includes('/node_modules/mdast') ||
              normalizedId.includes('/node_modules/hast') ||
              normalizedId.includes('/node_modules/vfile')
            ) {
              return 'markdown-editor-vendor';
            }

            if (normalizedId.includes('/node_modules/recharts/') || normalizedId.includes('/node_modules/d3-')) {
              return 'charts-vendor';
            }

            if (normalizedId.includes('canvas-confetti')) {
              return 'effects-vendor';
            }
          },
        },
      },
    },
    server: {
      proxy: {
        // 开发环境代理 - 可选地转发到私有代理服务
        '/api/hg-proxy': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          configure: (proxy) => {
            // 如果私有代理服务不可用，会报错
            proxy.on('error', () => {
              console.log('[Vite Proxy] 私有代理不可用，公开仓库默认不附带该服务');
              console.log('[Vite Proxy] 如需导入链路，请接入单独维护的私有代理/后端');
            });
          },
        },
        // 开发环境代理 - 将 /api/wiki-proxy 请求转发到本地代理
        '/api/wiki-proxy': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
