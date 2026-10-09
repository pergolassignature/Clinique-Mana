import { createElement, Suspense, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Home, Settings } from 'lucide-react'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { Forbidden, NotFound, RequireAccess } from '@/core/access/guards'
import { AccountPage } from '@/core/account/pages/AccountPage'
import { resolveEnabledModules } from '@/core/modules/resolve'
import type { SettingsSection } from '@/core/modules/types'
import { SettingsLayout } from '@/core/settings/SettingsLayout'
import { isUnder, SETTINGS_BASE_PATH, settingsSectionPath } from '@/core/settings/paths'
import { coreSettingsSections } from '@/core/settings/sections'
import { visibleSettingsSections } from '@/core/settings/visible-sections'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { preloadWhenIdle } from '@/shared/lib/lazy-page'
import { AppShell, type ShellNavItem } from './AppShell'
import { HomePage } from './HomePage'
import { ALL_MODULES } from './modules'

/**
 * Like RequireAccess, for a computed condition: the settings route opens when one section is
 * accessible. Otherwise « Paramètres » and its sections are « Accès refusé », and a path under
 * it that names no section is « Page introuvable », as everywhere else.
 */
function RequireAnySettings({ allowed, sections, children }: { allowed: boolean; sections: readonly SettingsSection[]; children: ReactNode }) {
  const { pathname } = useLocation()
  if (allowed) return <>{children}</>
  const root = pathname.replace(/[/]+$/, '').toLowerCase() === SETTINGS_BASE_PATH
  return root || sections.some((s) => isUnder(pathname, settingsSectionPath(s))) ? <Forbidden /> : <NotFound />
}

/** The signed-in app. Renders under RequireAuth, so access is ready (useReadyAccess throws otherwise). */
export function AuthenticatedApp() {
  // Enabled module keys come with the access payload (get_my_access): no extra query.
  const access = useReadyAccess()
  const { modules: enabledKeys, org_timezone } = access
  const { can } = useAccess()
  // A nav item or Accueil card may add a condition on the user beyond its permission (`shownWhen`).
  const shown = useCallback(
    (item: { permission: string; shownWhen?: (a: Access) => boolean }) => can(item.permission) && (item.shownWhen?.(access) ?? true),
    [can, access],
  )

  const modules = useMemo(() => resolveEnabledModules(ALL_MODULES, new Set(enabledKeys)), [enabledKeys])

  // Each module section carries its module's key, for its error scope (`settings:<moduleKey>:<id>`).
  const settingsSections = useMemo(
    () => [...coreSettingsSections, ...modules.flatMap((m) => m.settingsSections.map((s) => ({ ...s, moduleKey: m.key })))],
    [modules],
  )
  const visibleSections = useMemo(() => visibleSettingsSections(settingsSections, can), [settingsSections, can])
  // Decision #19: « Paramètres » exists only when it would show at least one section.
  const canOpenSettings = visibleSections.length > 0

  // Prefetch the code of every page this user can open, once the browser is idle: a first visit
  // then renders at once, without a Suspense fallback (and React's 300 ms hold of it). Static
  // chunks only, the same for everyone: no data is fetched before the page itself mounts. Skipped
  // with Data Saver or on 2G (preloadWhenIdle).
  const routeComponents = useMemo(
    () => modules.flatMap((m) => m.routes.filter((r) => can(r.permission)).map((r) => r.component)),
    [modules, can],
  )
  useEffect(() => {
    const idle = preloadWhenIdle([...visibleSections.map((s) => s.component), ...routeComponents])
    return idle.cancel
  }, [visibleSections, routeComponents])

  // The palette's record groups (⌘K): the enabled modules' providers this user may search.
  const searchProviders = useMemo(() => modules.flatMap((m) => m.search ?? []).filter((p) => can(p.permission)), [modules, can])

  // Accueil's module cards this user may see (each loads its own chunk when it renders).
  const homeCards = useMemo(() => modules.flatMap((m) => (m.homeCards ?? []).filter(shown)), [modules, shown])

  const navItems = useMemo<ShellNavItem[]>(() => {
    const moduleItems = modules
      .flatMap((m) => [m.nav ?? []].flat())
      .filter(shown)
      .sort((a, b) => a.order - b.order)
    return [
      { path: '/accueil', labelKey: 'nav.home', icon: Home },
      ...moduleItems,
      ...(canOpenSettings
        ? [
            {
              path: SETTINGS_BASE_PATH,
              labelKey: 'nav.settings' as const,
              icon: Settings,
              // Named in the topbar as « Paramètres / <section> ».
              subPages: visibleSections.map((s) => ({ path: settingsSectionPath(s), labelKey: s.labelKey })),
            },
          ]
        : []),
    ]
  }, [modules, shown, canOpenSettings, visibleSections])

  return (
    <UnsavedChangesProvider>
      {/* Keyed on the clinic time zone: a « Région » change remounts the whole shell (the bell, the
          palette, every page), so dates memoised or computed once with the old zone (useClinicDate,
          useMemo, a query key built from the clinic's date) are computed again. AccessProvider sets
          the zone before this renders; the save writes it into the cached access at once
          (useUpdateOrganization), so a failed refetch does not keep the old one. */}
      <AppShell key={org_timezone} navItems={navItems} searchProviders={searchProviders}>
        <Routes>
          <Route index element={<Navigate to="/accueil" replace />} />
          <Route path="accueil" element={<HomePage cards={homeCards} shortcuts={navItems.filter((item) => item.path !== '/accueil')} />} />
          {/* « Mon compte »: outside Paramètres, so every role reaches it (ACCOUNT_PAGE in the shell). */}
          <Route
            path="mon-compte"
            element={
              <RouteBoundary scope="account">
                <AccountPage />
              </RouteBoundary>
            }
          />
          {/* SettingsLayout wraps each section in its own RouteBoundary. */}
          <Route
            path="parametres/*"
            element={
              <RequireAnySettings allowed={canOpenSettings} sections={settingsSections}>
                <SettingsLayout sections={settingsSections} />
              </RequireAnySettings>
            }
          />
          {modules.flatMap((m) =>
            m.routes.map((r) => (
              <Route
                key={`${m.key}:${r.path}`}
                path={r.path}
                element={
                  <RequireAccess permission={r.permission}>
                    {/* Design §6.2: a crash or failed chunk stays inside its module. */}
                    <RouteBoundary scope={m.key}>
                      <Suspense fallback={<FullPageMessage role="status" title={t('common.loading')} />}>
                        {createElement(r.component)}
                      </Suspense>
                    </RouteBoundary>
                  </RequireAccess>
                }
              />
            )),
          )}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </UnsavedChangesProvider>
  )
}
