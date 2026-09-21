import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'integrated' ? '/calculator/' : '/',
  publicDir: false,
  define: mode === 'integrated' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  server: { proxy: { '/api': 'http://127.0.0.1:5000' } },
  build: mode === 'integrated' ? {
    outDir: 'dist-integrated',
    minify: true,
    lib: { entry: 'src/integrated.jsx', formats: ['es'], fileName: () => 'calculator.js', cssFileName: 'calculator' },
  } : {},
}))
