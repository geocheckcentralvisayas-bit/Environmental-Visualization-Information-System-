import { defineConfig } from 'vite';

// Relative asset paths so the built app can be embedded under /pixel-office/
// inside the ENVIS Dashboard without absolute /assets/ collisions.
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
