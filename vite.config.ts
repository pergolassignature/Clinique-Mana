import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Preloads Inter's latin file (the only subset French text uses; see the unicode-range rules in
 * @fontsource-variable/inter). Without it, the browser finds the font only once the JS has
 * rendered text. The file is hashed, so the link is added to the built index.html. Build only:
 * the dev server serves the font from node_modules.
 */
function preloadInterLatin(): Plugin {
  const FONT = /^assets\/inter-latin-wght-normal-[\w-]+\.woff2$/
  return {
    name: 'mana:preload-inter-latin',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const file = Object.keys(bundle ?? {}).find((name) => FONT.test(name))
        if (!file) throw new Error('preloadInterLatin: inter-latin-wght-normal-*.woff2 is not in the build (font package changed?)')
        return [
          {
            tag: 'link',
            // crossorigin: fonts are fetched in CORS mode; without it the preload is not reused.
            attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head',
          },
        ]
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), preloadInterLatin()],
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
