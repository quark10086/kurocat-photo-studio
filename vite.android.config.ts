import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: ['chrome80'],
    outDir: resolve(__dirname, 'android/app/src/main/assets/web'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'android-web.html'),
      },
    },
  },
});
