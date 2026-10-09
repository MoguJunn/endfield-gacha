// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';
import configureVite from '../../vite.config.js';

vi.mock('vite', () => ({ defineConfig: (config) => config, loadEnv: vi.fn() }));
vi.mock('@vitejs/plugin-react-swc', () => ({ default: () => ({ name: 'react' }) }));
vi.mock('@tailwindcss/postcss', () => ({ default: () => ({ postcssPlugin: 'tailwind' }) }));
vi.mock('autoprefixer', () => ({ default: () => ({ postcssPlugin: 'autoprefixer' }) }));
vi.mock('../_routes/index.js', () => ({ getApiRouteEntries: () => [] }));
vi.mock('../../scripts/lib/moduleRecoveryPlugin.mjs', () => ({ createModuleRecoveryPlugin: () => ({ name: 'recovery' }) }));

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const backendRoot = path.join(projectRoot, 'backend');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(loadEnv).mockReset();
});

describe('Vite development environment', () => {
  it('loads the selected project environment even when the CLI starts in another working tree', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(path.resolve(projectRoot, '../another-working-tree'));
    vi.stubEnv('DEV_API_ENV_PROBE', undefined);
    vi.mocked(loadEnv).mockImplementation((mode, directory) => (
      mode === 'development' && path.resolve(directory) === path.resolve(projectRoot)
        ? { DEV_API_ENV_PROBE: 'project-configured' } : {}
    ));

    configureVite({ mode: 'development' });

    expect(process.env.DEV_API_ENV_PROBE).toBe('project-configured');
    expect(loadEnv).toHaveBeenCalledWith('development', projectRoot, '');
    expect(loadEnv).toHaveBeenCalledWith('development', backendRoot, '');
  });

  it('keeps project values ahead of backend values and preserves explicit process settings', () => {
    vi.stubEnv('DEV_API_ENV_PROBE', undefined);
    vi.stubEnv('DEV_API_BACKEND_PROBE', undefined);
    vi.stubEnv('DEV_API_EXTERNAL_PROBE', 'explicit-setting');
    vi.mocked(loadEnv).mockImplementation((_mode, directory) => (
      path.resolve(directory) === path.resolve(projectRoot)
        ? { DEV_API_ENV_PROBE: 'project', DEV_API_EXTERNAL_PROBE: 'file-value' }
        : { DEV_API_ENV_PROBE: 'backend', DEV_API_BACKEND_PROBE: 'backend-only' }
    ));

    configureVite({ mode: 'production' });

    expect(process.env.DEV_API_ENV_PROBE).toBe('project');
    expect(process.env.DEV_API_BACKEND_PROBE).toBe('backend-only');
    expect(process.env.DEV_API_EXTERNAL_PROBE).toBe('explicit-setting');
  });
});
