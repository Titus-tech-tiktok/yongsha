import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = Number(env.PORT || process.env.PORT || 8790) || 8790;
  const apiHost = String(env.CAISHEN_HOST || process.env.CAISHEN_HOST || '127.0.0.1');
  const proxyHost = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost;

  return {
    server: {
      proxy: {
        '/api': `http://${proxyHost}:${apiPort}`
      }
    }
  };
});
