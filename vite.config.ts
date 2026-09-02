import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves the app under /<repo>/, so the base path is set from an
// env var at build time. Locally it stays '/' and nothing needs configuring.
export default defineConfig({
  base: process.env.APP_BASE_PATH ?? '/',
  plugins: [react()],
  build: { sourcemap: true },
});
