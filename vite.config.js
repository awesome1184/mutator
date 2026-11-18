import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The repository is published at https://<user>.github.io/mutator/.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/mutator/' : '/'
});
