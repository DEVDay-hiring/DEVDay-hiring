import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'] },
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts: ['.cloudspaces.litng.ai'],
  },
  optimizeDeps: { exclude: ['onnxruntime-web'], include: ['react', 'react-dom/client'], entries: ['index.html'] },
  build: { assetsInlineLimit: 0 },
})
