// One self-contained HTML file (scripts, styles and fonts inlined) that runs
// from disk with no server: npm run build:offline -> dist/offline/mutator.html
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./src/client'),
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: {
    'import.meta.env.VITE_STANDALONE': JSON.stringify('1')
  },
  resolve: {
    alias: {
      '@devvit/web/client': here('./src/client/lib/devvit-stub.ts')
    }
  },
  build: {
    outDir: here('./dist/offline'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: here('./src/client/game.html') }
  }
});
