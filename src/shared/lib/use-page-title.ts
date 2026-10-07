import { useEffect } from 'react'
import { t } from '@/i18n'

/** Sets the browser tab title to « <page> · Clinique MANA » while the page is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`
  }, [title])
}
