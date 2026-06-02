import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/kodeui/',
  resolve: {
    alias: {
      '@kodeui': path.resolve(__dirname, 'src/lib'),
    },
  },
  build: {
    outDir: 'docs-dist',
  },
})
