import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Vite listens on localhost ([::1]); the app's single local origin is http://localhost:5173.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Just above the largest chunk (react, ~217 kB): a new heavy dependency should be noticed.
    chunkSizeWarningLimit: 230,
    rollupOptions: {
      output: {
        // Vendor code changes rarely: separate chunks stay cached across app deploys.
        manualChunks: {
          // react-dom/client is the React 19 renderer; 'react-dom' alone is only its small shared entry.
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
