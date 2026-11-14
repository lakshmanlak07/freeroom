import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `vite --mode mock` (pnpm dev:mock) serves the API from MSW; setting VITE_USE_MOCKS=true also works.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  ...(mode === 'mock' && { define: { 'import.meta.env.VITE_USE_MOCKS': JSON.stringify('true') } }),
}));
