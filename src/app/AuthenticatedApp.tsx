import { createElement, Suspense, useMemo, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Home, Settings } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { Forbidden, RequireAccess } from '@/core/access/guards'
import { resolveEnabledModules } from '@/core/modules/resolve'
import { SettingsLayout } from '@/core/settings/SettingsLayout'
import { SETTINGS_BASE_PATH, settingsSectionPath } from '@/core/settings/paths'
import { coreSettingsSections } from '@/core/settings/sections'
import { visibleSettingsSections } from '@/core/settings/visible-sections'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { AppShell, type ShellNavItem } from './AppShell'
import { HomePage } from './HomePage'
import { ALL_MODULES } from './modules'

function NotFoundPage() {
  usePageTitle(t('pageTitles.notFound'))
  return <FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} />
}

/** Like RequireAccess, for a computed condition: the settings route opens when one section is accessible. */
function RequireAnyAccess({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (!allowed) return <Forbidden />
  return <>{children}</>
}

/** The signed-in app. Renders under RequireAuth, so access is ready (useReadyAccess throws otherwise). */
export function AuthenticatedApp() {
  // Enabled module keys come with the access payload (get_my_access): no extra query.
  const { modules: enabledKeys } = useReadyAccess()
  const { can } = useAccess()

  const modules = useMemo(() => resolveEnabledModules(ALL_MODULES, new Set(enabledKeys)), [enabledKeys])

  // Each module section carries its module's key, for its error scope (`settings:<moduleKey>:<id>`).
  const settingsSections = useMemo(
    () => [...coreSettingsSections, ...modules.flatMap((m) => m.settingsSections.map((s) => ({ ...s, moduleKey: m.key })))],
    [modules],
  )
  const visibleSections = useMemo(() => visibleSettingsSections(settingsSections, can), [settingsSections, can])
  // Decision #19: « Paramètres » exists only when it would show at least one section.
  const canOpenSettings = visibleSections.length > 0

  const navItems = useMemo<ShellNavItem[]>(() => {
    const moduleItems = modules
      .flatMap((m) => (m.nav && can(m.nav.permission) ? [m.nav] : []))
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
  }, [modules, can, canOpenSettings, visibleSections])

  return (
    <UnsavedChangesProvider>
      <AppShell navItems={navItems}>
        <Routes>
          <Route index element={<Navigate to="/accueil" replace />} />
          <Route path="accueil" element={<HomePage />} />
          {/* SettingsLayout wraps each section in its own RouteBoundary. */}
          <Route
            path="parametres/*"
            element={
              <RequireAnyAccess allowed={canOpenSettings}>
                <SettingsLayout sections={settingsSections} />
              </RequireAnyAccess>
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </UnsavedChangesProvider>
  )
}
