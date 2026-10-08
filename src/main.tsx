import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { App } from '@/app/App'
import { CHUNK_ERROR_PATTERNS } from '@/shared/lib/app-update'
import { scrubSentryEvent } from '@/shared/lib/sentry-scrub'
import '@/styles/globals.css'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // A chunk that fails to load is a deploy since the tab opened, not a bug: the error boundaries
    // reload to the new version (shared/lib/app-update.ts).
    ignoreErrors: [...CHUNK_ERROR_PATTERNS],
    // Backstop: no PostgreSQL details/hint, no long digit runs (account numbers…), no auth tokens in
    // URLs (fragments, `code`, `token_hash`…) leave the browser.
    beforeSend: (event) => scrubSentryEvent(event),
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('#root not found in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
