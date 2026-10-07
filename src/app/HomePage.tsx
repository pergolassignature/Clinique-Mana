import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { usePageTitle } from '@/shared/lib/use-page-title'

export function HomePage() {
  usePageTitle(t('pageTitles.home'))
  const { display_name } = useReadyAccess()
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">
        {display_name ? `${t('home.title')}, ${display_name}` : t('home.title')}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('home.body')}</p>
    </div>
  )
}
