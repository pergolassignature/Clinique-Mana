import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

/**
 * Preloads Inter's latin file (the only subset French text uses; see the unicode-range rules in
 * @fontsource-variable/inter). Without it, the browser finds the font only once the JS has
 * rendered text. The file is hashed, so the link is added to the built index.html. Build only:
 * the dev server serves the font from node_modules.
 */
function preloadInterLatin(): Plugin {
  const FONT = /^assets\/inter-latin-wght-normal-[\w-]+\.woff2$/
  // The public base the build serves assets from ('/' unless `base` is set): the bundle's file names
  // are relative to it.
  let base = '/'
  return {
    name: 'mana:preload-inter-latin',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const file = Object.keys(bundle ?? {}).find((name) => FONT.test(name))
        if (!file) throw new Error('preloadInterLatin: inter-latin-wght-normal-*.woff2 is not in the build (font package changed?)')
        return [
          {
            tag: 'link',
            // crossorigin: fonts are fetched in CORS mode; without it the preload is not reused.
            attrs: { rel: 'preload', href: `${base}${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head',
          },
        ]
      },
    },
  }
}

/** The origin of an `http(s)` URL, or null (an unset or malformed variable adds nothing). */
function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The page may frame only itself, Supabase (« Aperçu » of a stored PDF: a signed storage URL) and
 * the clinic's Documenso (the embedded signing of the image consent, P4-488), each origin from the
 * build's environment (`VITE_SUPABASE_URL`, `VITE_DOCUMENSO_URL`), never hard-coded: a
 * `Content-Security-Policy` meta with `frame-src` only (no other directive changes). Without
 * `VITE_DOCUMENSO_URL` the embed is refused by the browser and the page falls back to the signing
 * page itself. The sandboxed previews (`srcdoc`) are not fetched, so `frame-src` does not apply.
 */
function frameSources(env: Record<string, string>): Plugin {
  const sources = ["'self'", originOf(env.VITE_SUPABASE_URL), originOf(env.VITE_DOCUMENSO_URL)].filter(Boolean)
  return {
    name: 'mana:frame-src',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: `frame-src ${sources.join(' ')}` }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), preloadInterLatin(), frameSources(loadEnv(mode, process.cwd(), 'VITE_'))],
  // Vite listens on localhost ([::1]); the app's single local origin is http://localhost:5173.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // No sourcemaps (Vite's default): even `hidden` ones would be served from /assets. They come
    // with the Sentry upload at « Mise en service », which deletes them after uploading.
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
}))
