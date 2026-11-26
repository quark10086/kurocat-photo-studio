import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  build: {
    // Ensure compatibility with macOS 10.15 Catalina WKWebView (Safari 13-15) and Win7 WebView2 109
    target: ['safari13', 'chrome90'],
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        menu: path.resolve(__dirname, 'menu.html'),
        obs: path.resolve(__dirname, 'obs.html'),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
