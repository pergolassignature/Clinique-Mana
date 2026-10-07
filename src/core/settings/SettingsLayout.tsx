import { createElement, Suspense, useEffect, useId, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ChevronDown, Lock } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import type { SettingsSection } from '@/core/modules/types'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { SETTINGS_BASE_PATH, settingsSectionPath } from './paths'
import { isSectionReadOnly, SettingsSectionContext } from './section-context'
import { SETTINGS_GROUP_ORDER, visibleSettingsSections } from './visible-sections'

const sectionScope = (s: SettingsSection) => (s.moduleKey ? `settings:${s.moduleKey}:${s.id}` : `settings:${s.id}`)

// Case-insensitive, like React Router's matching (/parametres/Identite opens the same section).
const isUnder = (pathname: string, path: string) => {
  const location = pathname.toLowerCase()
  const target = path.toLowerCase()
  return location === target || location.startsWith(`${target}/`)
}

/** Titles the browser tab. A leaf component: React runs child effects first, so a parent's title would win. */
function PageTitle({ title }: { title: string }) {
  usePageTitle(title)
  return null
}

/**
 * Focuses the first h2 the section pane shows, now or once its lazy page has loaded. Pages give
 * their h2 `tabIndex={-1}` (PageHeader does); a heading without one gets it here.
 */
function focusSectionHeading(pane: HTMLElement): () => void {
  const focus = () => {
    const heading = pane.querySelector<HTMLElement>('h2')
    if (!heading) return false
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    heading.focus()
    return true
  }
  if (focus()) return () => {}
  const observer = new MutationObserver(() => {
    if (focus()) observer.disconnect()
  })
  observer.observe(pane, { childList: true, subtree: true })
  return () => observer.disconnect()
}

interface SettingsLayoutProps {
  sections: SettingsSection[]
  /** Where the layout is mounted (under a splat route, e.g. `parametres/*`). Menu links are absolute. */
  basePath?: string
}

/**
 * Settings shell (design system « SettingsNav »): one nested route per section the user can
 * access, at its French `path`, and a menu grouped under overlines. From `md` up the menu is a
 * 200 px column; below, a disclosure button naming the current section opens it above the page,
 * and choosing a section closes it and moves focus to the section's h2.
 * A section the user can see but not change shows a lock in the menu; its page reads `readOnly`
 * from `useSettingsSection()`. Each section has its own error boundary, so a crashing section
 * leaves the menu usable.
 */
export function SettingsLayout({ sections, basePath = SETTINGS_BASE_PATH }: SettingsLayoutProps) {
  const { can } = useAccess()
  const location = useLocation()
  const navId = useId()
  const paneRef = useRef<HTMLElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // Set when a section is chosen from the open (phone) menu: focus its heading once it shows.
  const focusHeadingNext = useRef(false)

  // In menu order, so /parametres opens the first section listed.
  const visible = visibleSettingsSections(sections, can)
  const first = visible[0]
  const current = visible.find((s) => isUnder(location.pathname, settingsSectionPath(s, basePath)))

  // Every navigation (including choosing the open section again) closes the phone menu. After
  // « Rester » in the unsaved-changes dialog nothing navigates, so the menu stays open.
  useEffect(() => {
    setMenuOpen(false)
    if (!focusHeadingNext.current || !paneRef.current) return
    focusHeadingNext.current = false
    return focusSectionHeading(paneRef.current)
  }, [location.key])

  const title = <h1 className="mb-5 text-xl font-semibold tracking-tight">{t('settings.title')}</h1>

  if (!first) {
    return (
      <div>
        <PageTitle title={t('pageTitles.settings')} />
        {title}
        <FullPageMessage title={t('settings.empty')} headingLevel={2} compact />
      </div>
    )
  }

  return (
    <div>
      {title}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="md:w-[200px] md:shrink-0">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => {
              focusHeadingNext.current = false
              setMenuOpen((open) => !open)
            }}
            className={`flex min-h-11 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm font-medium text-foreground transition-colors duration-120 hover:border-border-strong md:hidden ${focusRing}`}
          >
            {current && <current.icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">
              <span className="sr-only">{t('settings.menuButtonPrefix')} </span>
              {current ? t(current.labelKey) : t('settings.navLabel')}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 text-subtle transition-transform duration-120', menuOpen && 'rotate-180')}
              aria-hidden
            />
          </button>
          <nav
            id={navId}
            aria-label={t('settings.navLabel')}
            data-state={menuOpen ? 'open' : 'closed'}
            className="max-md:mt-2 max-md:data-[state=closed]:hidden"
          >
            {SETTINGS_GROUP_ORDER.map((group) => {
              const items = visible.filter((s) => s.group === group)
              if (items.length === 0) return null
              const headingId = `${navId}-group-${group}`
              return (
                <div key={group} role="group" aria-labelledby={headingId} className="mb-3">
                  <p id={headingId} className="mb-0.5 px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`settings.groups.${group}`)}
                  </p>
                  {items.map((s) => (
                    <GuardedNavLink
                      key={s.id}
                      to={settingsSectionPath(s, basePath)}
                      onClick={() => {
                        if (menuOpen) focusHeadingNext.current = true
                      }}
                      className={({ isActive }) =>
                        cn(
                          `flex min-h-11 items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors duration-120 md:min-h-0 md:py-[5px] ${focusRing}`,
                          isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )
                      }
                    >
                      <s.icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                      {t(s.labelKey)}
                      {isSectionReadOnly(s, can) && (
                        <>
                          <Lock className="ml-auto h-3 w-3 shrink-0 text-subtle" aria-hidden />
                          <span className="sr-only"> {t('settings.navReadOnlyHint')}</span>
                        </>
                      )}
                    </GuardedNavLink>
                  ))}
                </div>
              )
            })}
          </nav>
        </div>
        <section ref={paneRef} className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to={first.path} replace />} />
            {visible.map((s) => (
              <Route
                key={s.id}
                path={s.path}
                element={
                  <RouteBoundary scope={sectionScope(s)} compact>
                    <PageTitle title={`${t(s.labelKey)} · ${t('pageTitles.settings')}`} />
                    <SettingsSectionContext.Provider value={{ section: s, readOnly: isSectionReadOnly(s, can) }}>
                      <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
                        {createElement(s.component)}
                      </Suspense>
                    </SettingsSectionContext.Provider>
                  </RouteBoundary>
                }
              />
            ))}
            <Route
              path="*"
              element={
                <>
                  <PageTitle title={t('pageTitles.settings')} />
                  <FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} headingLevel={2} compact />
                </>
              }
            />
          </Routes>
        </section>
      </div>
    </div>
  )
}
