import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src/lib'],
      outDir: 'dist',
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/lib/index.ts'),
      name: 'KodeUI',
      formats: ['es', 'umd'],
      fileName: 'kodeui',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
      },
    },
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@kodeui': path.resolve(__dirname, 'src/lib'),
    },
  },
})
