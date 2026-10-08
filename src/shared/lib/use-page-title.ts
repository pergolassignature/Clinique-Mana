import { useEffect } from 'react'
import { t } from '@/i18n'
import { useShellCrumb } from './shell-crumb'

/**
 * Sets the browser tab title to « <page> · Clinique MANA » while the page is shown. A detail page
 * passes `{ crumb: true }` to also show the title as the topbar's last crumb (« Professionnels / <name> »).
 */
export function usePageTitle(title: string, { crumb = false }: { crumb?: boolean } = {}): void {
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`
  }, [title])
  useShellCrumb(crumb ? title : null)
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
