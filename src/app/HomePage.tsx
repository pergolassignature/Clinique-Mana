import { createElement, Suspense } from 'react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import type { ModuleHomeCard } from '@/core/modules/types'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { PageHeader } from '@/shared/components/PageHeader'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { formatDateOnlyFull } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { HomeImportantNotices } from './HomeImportantNotices'

/**
 * Accueil: the greeting (the page's h1, like every page title) with today's date in the clinic on
 * the right, the important notices, then the enabled modules' cards this user may see
 * (`ModuleManifest.homeCards`; a provider's « Complétez votre profil », Task 4b.5). A card renders
 * nothing while its chunk loads or when it has nothing to say; a crash stays inside its card.
 */
export function HomePage({ cards = [] }: { cards?: readonly ModuleHomeCard[] }) {
  usePageTitle(t('pageTitles.home'))
  const { display_name } = useReadyAccess()
  // The clinic's calendar day (a date, no time), so it changes at the clinic's midnight.
  const today = useClinicDate()
  return (
    <>
      <PageHeader
        level={1}
        title={display_name ? `${t('home.title')}, ${display_name}` : t('home.title')}
        description={t('home.body')}
        actions={<p className="text-sm text-muted-foreground max-sm:hidden">{formatDateOnlyFull(today)}</p>}
      />
      {cards.map((card) => (
        <ErrorBoundary key={card.id} scope={`home:${card.id}`} compact>
          <Suspense fallback={null}>{createElement(card.component)}</Suspense>
        </ErrorBoundary>
      ))}
      <HomeImportantNotices />
    </>
  )
}
