import { defineConfig } from 'vite';

// Isolated demo: these headers do not affect the Realtime application.
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig({
  server: { headers },
  preview: { headers },
  worker: { format: 'es' },
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'] },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { assetsInlineLimit: 0 },
});
