import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // WEB_PORT / VITE_API_PROXY let a second copy (e.g. on the test database) run beside the usual one
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: Boolean(process.env.WEB_PORT),
    // same-origin API in development, so cookies and CSRF work without CORS
    proxy: { '/api': process.env.VITE_API_PROXY || 'http://localhost:4000' },
  },
  build: {
    rollupOptions: {
      output: {
        // libraries change less often than the app, so browsers keep them cached across releases
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|cookie|set-cookie-parser)[\\/]/.test(id)) return 'react';
          if (/node_modules[\\/]@tanstack[\\/]/.test(id)) return 'query';
          return undefined;
        },
      },
    },
  },
});
