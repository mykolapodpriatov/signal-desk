import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects, matching the two halves of the app:
//
//   node — src/core and src/stream: the ring buffer, candle aggregation,
//          indicators, the feed adapters. No DOM. A test here needing jsdom
//          means something has leaked out of the core.
//   dom  — components and routes under jsdom + Testing Library.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          globals: true,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: [
            'src/**/*.test.tsx',
            'test/**/*.test.tsx',
            'bench/**/*.test.tsx',
          ],
          setupFiles: ['./test/setup-dom.ts'],
          globals: true,
        },
      },
    ],
  },
});
