import { createElement, Suspense, useEffect, useId, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ChevronDown, Lock } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Forbidden, NotFound } from '@/core/access/guards'
import type { SettingsSection } from '@/core/modules/types'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { isUnder, SETTINGS_BASE_PATH, settingsSectionPath } from './paths'
import { isSectionReadOnly, SettingsSectionContext } from './section-context'
import { SETTINGS_GROUP_ORDER, visibleSettingsSections } from './visible-sections'

const sectionScope = (s: SettingsSection) => (s.moduleKey ? `settings:${s.moduleKey}:${s.id}` : `settings:${s.id}`)

/** Titles the browser tab. A leaf component: React runs child effects first, so a parent's title would win. */
function PageTitle({ title }: { title: string }) {
  usePageTitle(title)
  return null
}

/**
 * The compact layout (below `xl`: phones, tablets, small laptops), where the menu is a disclosure
 * above the page. A 200 px menu column beside the shell's sidebar left a 768 px tablet about 230 px
 * of page and a 1024 px laptop about 530, narrower than the reference lists (up to ~580 px with
 * their « Monter / Descendre » buttons); from `xl` the page keeps about 790 px beside it.
 */
const COMPACT_QUERY = '(max-width: 1279px)'
const WIDE_QUERY = '(min-width: 1280px)'
const isCompactLayout = () => typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches

/** How long to wait for a lazy page's heading before giving up. */
const HEADING_WAIT_MS = 5000

/**
 * Focuses the first h2 the section pane shows, now or once its lazy page has loaded. Pages give
 * their h2 `tabIndex={-1}` (PageHeader does); a heading without one gets it here.
 * The wait is bounded: it stops on the first focus or pointer press inside the pane (the user is
 * already working there; a late heading must not steal focus from a field) or after 5 s.
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
    if (focus()) stop()
  })
  const timer = window.setTimeout(() => stop(), HEADING_WAIT_MS)
  function stop() {
    observer.disconnect()
    window.clearTimeout(timer)
    pane.removeEventListener('focusin', stop)
    pane.removeEventListener('pointerdown', stop)
  }
  observer.observe(pane, { childList: true, subtree: true })
  pane.addEventListener('focusin', stop)
  pane.addEventListener('pointerdown', stop)
  return stop
}

interface SettingsLayoutProps {
  sections: SettingsSection[]
  /** Where the layout is mounted (under a splat route, e.g. `parametres/*`). Menu links are absolute. */
  basePath?: string
}

/**
 * Settings shell (design system « SettingsNav »): one nested route per section the user can
 * access, at its French `path`, and a menu grouped under overlines. From `xl` up the menu is a
 * 200 px column; below (phones, tablets, small laptops), a disclosure button naming the current section opens
 * it above the page (groups in two columns from `sm`), and choosing a section closes it and moves
 * focus to the section's h2.
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
  // The section chosen from the compact menu: its heading gets focus once that section shows. Kept
  // as a path, so a later navigation elsewhere (after « Rester », through the breadcrumb…) never
  // moves focus.
  const focusHeadingOf = useRef<string | null>(null)

  // In menu order, so /parametres opens the first section listed.
  const visible = visibleSettingsSections(sections, can)
  const first = visible[0]
  const current = visible.find((s) => isUnder(location.pathname, settingsSectionPath(s, basePath)))

  // Every navigation (including choosing the open section again) closes the compact menu. After
  // « Rester » in the unsaved-changes dialog nothing navigates, so the menu stays open.
  useEffect(() => {
    setMenuOpen(false)
    const target = focusHeadingOf.current
    focusHeadingOf.current = null
    if (!target || location.pathname.toLowerCase() !== target.toLowerCase() || !paneRef.current) return
    return focusSectionHeading(paneRef.current)
    // location.key: choosing the open section again is a navigation too (same pathname, new key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // The disclosure is the compact layout only: close it when the window widens to xl, like the
  // shell's sheet past md.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const wide = window.matchMedia(WIDE_QUERY)
    const onChange = () => {
      if (!wide.matches) return
      setMenuOpen(false)
      focusHeadingOf.current = null
    }
    wide.addEventListener('change', onChange)
    return () => wide.removeEventListener('change', onChange)
  }, [])

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
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-6">
        {/* 212, not the handoff's 200: the longest label with its icon and a « Lecture seule » lock fits on one line. */}
        <div className="xl:w-[212px] xl:shrink-0">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => {
              focusHeadingOf.current = null
              setMenuOpen((open) => !open)
            }}
            className={`flex min-h-11 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm font-medium text-foreground transition-colors duration-120 hover:border-border-strong xl:hidden ${focusRing}`}
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
            className="max-xl:mt-2 max-xl:data-[state=closed]:hidden sm:max-xl:columns-2 sm:max-xl:gap-6"
          >
            {SETTINGS_GROUP_ORDER.map((group) => {
              const items = visible.filter((s) => s.group === group)
              if (items.length === 0) return null
              const headingId = `${navId}-group-${group}`
              return (
                <div key={group} role="group" aria-labelledby={headingId} className="mb-3 break-inside-avoid">
                  <p id={headingId} className="mb-0.5 px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`settings.groups.${group}`)}
                  </p>
                  {items.map((s) => (
                    <GuardedNavLink
                      key={s.id}
                      to={settingsSectionPath(s, basePath)}
                      onClick={() => {
                        focusHeadingOf.current = isCompactLayout() ? settingsSectionPath(s, basePath) : null
                      }}
                      className={({ isActive }) =>
                        cn(
                          `flex min-h-11 items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors duration-120 xl:min-h-0 xl:py-[5px] ${focusRing}`,
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
            {/* A section this user does not see reads « Accès refusé », like every page they may not
                open; only a path that names no section is « Page introuvable ». */}
            <Route
              path="*"
              element={
                sections.some((s) => isUnder(location.pathname, settingsSectionPath(s, basePath))) ? <Forbidden compact /> : <NotFound compact />
              }
            />
          </Routes>
        </section>
      </div>
    </div>
  )
}
