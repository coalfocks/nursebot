import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Netlify can override both values; local/CI builds still get traceable metadata.
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(
      process.env.VITE_BUILD_ID ?? process.env.COMMIT_REF ?? 'local-development'
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
    // This suite imports Deno's https: stdlib and must run with Deno.
    exclude: ['**/node_modules/**', '**/dist/**', 'supabase/functions/consultant-chat/guards.test.ts'],
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
