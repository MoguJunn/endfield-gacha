import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: './tests/setup.js',
    globals: true,
    css: true,
    include: [
      'src/**/__tests__/**/*.{test,spec}.{js,jsx}',
      'api/**/__tests__/**/*.{test,spec}.{js,jsx}',
      'bots/**/__tests__/**/*.{test,spec}.{js,jsx}',
    ],
  },
});
