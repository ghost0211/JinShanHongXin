import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientPkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};
const releaseConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../release-config.json'), 'utf8'),
) as { repo: string; minNativeVersion: string };
const appVersion = (process.env.JINSHAN_APP_VERSION || clientPkg.version || '0.3.0').replace(
  /^v/i,
  '',
);

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GITHUB_REPO__: JSON.stringify(releaseConfig.repo),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:3001',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
