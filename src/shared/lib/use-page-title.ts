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
