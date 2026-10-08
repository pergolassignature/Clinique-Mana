import { useEffect } from 'react'
import { t } from '@/i18n'

/** Sets the browser tab title to « <page> · Clinique MANA » while the page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`
  }, [title])
}

/**
 * Asks search engines not to index the page while it is shown (`<meta name="robots"
 * content="noindex">`): public pages reached through a token link (`/invitation`).
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}
