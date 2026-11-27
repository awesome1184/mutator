// Standalone web build (GitHub Pages / local testing). Same client, but the
// game service runs in the browser on localStorage instead of Devvit.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./src/client'),
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_STANDALONE': JSON.stringify('1')
  },
  resolve: {
    alias: {
      '@devvit/web/client': here('./src/client/lib/devvit-stub.ts')
    }
  },
  build: {
    outDir: here('./dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: here('./src/client/index.html'),
        game: here('./src/client/game.html'),
        splash: here('./src/client/splash.html')
      }
    }
  }
});
