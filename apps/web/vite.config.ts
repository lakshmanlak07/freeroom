import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rewrite = (p: string) => p.replace(/^\/api/, '');

// `vite --mode mock` (pnpm dev:mock) serves the API from MSW; setting VITE_USE_MOCKS=true also works.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Same-origin /api like CloudFront in AWS: the local API (pnpm dev:api) sits behind the proxy.
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3001', rewrite } } },
  preview: { proxy: { '/api': { target: 'http://localhost:3001', rewrite } } },
  ...(mode === 'mock' && { define: { 'import.meta.env.VITE_USE_MOCKS': JSON.stringify('true') } }),
}));
