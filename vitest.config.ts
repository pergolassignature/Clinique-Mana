import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

// Pin the host timezone to something other than the clinic default
// (America/Toronto) so timezone tests prove there is no host-dependent shift.
// Set here (before workers start) so it also applies to `npx vitest run`.
process.env.TZ = 'America/Vancouver'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
