import { createElement, Suspense, useRef } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import type { ModuleHomeCard } from '@/core/modules/types'
import { EmptyState } from '@/shared/components/EmptyState'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { PageHeader } from '@/shared/components/PageHeader'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { formatDateOnlyFull } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import { HomeImportantNotices } from './HomeImportantNotices'
import type { ShellNavItem } from './shell/shell-pages'
import { PENDING_ATTRIBUTE, useNothingShown } from './use-nothing-shown'

/** A card's placeholder while its chunk loads: in the DOM, so Accueil knows it is not empty yet. */
const pendingCard = <span hidden {...{ [PENDING_ATTRIBUTE]: '' }} />

interface HomePageProps {
  cards?: readonly ModuleHomeCard[]
  /** The pages this user can open from the menu, Accueil aside: the empty state's shortcuts. */
  shortcuts?: readonly Pick<ShellNavItem, 'path' | 'labelKey' | 'icon'>[]
}

/**
 * Accueil: the greeting (the page's h1, like every page title) with today's date in the clinic on
 * the right, the important notices, then the enabled modules' cards this user may see
 * (`ModuleManifest.homeCards`; a provider's « Complétez votre profil », Task 4b.5). A card renders
 * nothing while its chunk loads or when it has nothing to say; a crash stays inside its card.
 * When, everything loaded, nothing shows, a calm card says so and offers the role's shortcuts
 * (staff: Professionnels, Paramètres when allowed; a professional: Mon profil, Mes documents).
 */
export function HomePage({ cards = [], shortcuts = [] }: HomePageProps) {
  usePageTitle(t('pageTitles.home'))
  const { display_name } = useReadyAccess()
  // The clinic's calendar day (a date, no time), so it changes at the clinic's midnight.
  const today = useClinicDate()
  const content = useRef<HTMLDivElement>(null)
  const nothingShown = useNothingShown(content)
  return (
    <>
      <PageHeader
        level={1}
        title={display_name ? `${t('home.title')}, ${display_name}` : t('home.title')}
        description={t('home.body')}
        actions={<p className="text-sm text-muted-foreground max-sm:hidden">{formatDateOnlyFull(today)}</p>}
      />
      {/* `contents`: the cards stay items of the page's column (its gap), the wrapper only groups
          them so useNothingShown can tell whether any of them shows something. */}
      <div ref={content} className="contents">
        {cards.map((card) => (
          <ErrorBoundary key={card.id} scope={`home:${card.id}`} compact>
            <Suspense fallback={pendingCard}>{createElement(card.component)}</Suspense>
          </ErrorBoundary>
        ))}
        <HomeImportantNotices />
      </div>
      {nothingShown && (
        <div className="rounded-lg border border-border bg-card p-4">
          <EmptyState
            inCard
            title={t('home.empty.title')}
            action={
              shortcuts.length > 0 && (
                <nav aria-label={t('home.empty.shortcuts')}>
                  <ul className="flex flex-wrap gap-2">
                    {shortcuts.map((item) => (
                      <li key={item.path}>
                        <Button asChild variant="outline" size="sm" className="max-sm:h-11">
                          <Link to={item.path}>
                            <item.icon className="h-3.5 w-3.5" aria-hidden />
                            {t(item.labelKey)}
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </nav>
              )
            }
          />
        </div>
      )}
    </>
  )
}
