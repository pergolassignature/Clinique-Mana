import { createElement, Suspense } from 'react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import type { ModuleHomeCard } from '@/core/modules/types'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { HomeImportantNotices } from './HomeImportantNotices'

/**
 * Accueil: the greeting, the important notices, then the enabled modules' cards this user may see
 * (`ModuleManifest.homeCards`; a provider's « Complétez votre profil », Task 4b.5). A card renders
 * nothing while its chunk loads or when it has nothing to say; a crash stays inside its card.
 */
export function HomePage({ cards = [] }: { cards?: readonly ModuleHomeCard[] }) {
  usePageTitle(t('pageTitles.home'))
  const { display_name } = useReadyAccess()
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {display_name ? `${t('home.title')}, ${display_name}` : t('home.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('home.body')}</p>
      </div>
      {cards.map((card) => (
        <ErrorBoundary key={card.id} scope={`home:${card.id}`} compact>
          <Suspense fallback={null}>{createElement(card.component)}</Suspense>
        </ErrorBoundary>
      ))}
      <HomeImportantNotices />
    </>
  )
}
