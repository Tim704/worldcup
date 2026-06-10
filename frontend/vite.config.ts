import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
//
// Dev-server proxy (CONTRACT §2): every `/api/*` request from the Vite dev
// server is forwarded to the local Node/Express API on port 8080, mirroring
// the production nginx proxy so the SPA can use the same-origin '/api' base
// in both environments.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
