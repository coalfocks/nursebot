import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const sourceCommit = process.env.VITE_BUILD_ID
  ?? process.env.COMMIT_REF
  ?? process.env.GIT_COMMIT
  ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Netlify can override both values; keep the checked-in fallback traceable
    // when a production build is run outside Netlify's build environment.
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(
      sourceCommit
    ),
    'import.meta.env.VITE_DEPLOYMENT_TIMESTAMP': JSON.stringify(
      process.env.VITE_DEPLOYMENT_TIMESTAMP ?? new Date().toISOString()
    ),
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
    },
  },
});
