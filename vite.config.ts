import { defineConfig } from 'vite';

// Configuración pensada para Tauri: puerto fijo y salida mínima.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    cssMinify: true,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
});
