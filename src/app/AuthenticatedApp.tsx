import { createElement, Suspense, useMemo } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Home, Settings } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { RequireAccess } from '@/core/access/guards'
import { resolveEnabledModules } from '@/core/modules/resolve'
import { SettingsLayout } from '@/core/settings/SettingsLayout'
import { coreSettingsSections } from '@/core/settings/sections'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { AppShell, type ShellNavItem } from './AppShell'
import { HomePage } from './HomePage'
import { ALL_MODULES } from './modules'

function NotFoundPage() {
  usePageTitle(t('pageTitles.notFound'))
  return <FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} />
}

/** The signed-in app. Renders under RequireAuth, so access is ready (useReadyAccess throws otherwise). */
export function AuthenticatedApp() {
  // Enabled module keys come with the access payload (get_my_access): no extra query.
  const { modules: enabledKeys } = useReadyAccess()
  const { can } = useAccess()

  const modules = useMemo(() => resolveEnabledModules(ALL_MODULES, new Set(enabledKeys)), [enabledKeys])

  const navItems = useMemo<ShellNavItem[]>(() => {
    const moduleItems = modules
      .flatMap((m) => (m.nav && can(m.nav.permission) ? [m.nav] : []))
      .sort((a, b) => a.order - b.order)
    return [
      { path: '/accueil', labelKey: 'nav.home', icon: Home },
      ...moduleItems,
      ...(can('settings.view') ? [{ path: '/parametres', labelKey: 'nav.settings' as const, icon: Settings }] : []),
    ]
  }, [modules, can])

  const settingsSections = useMemo(() => [...coreSettingsSections, ...modules.flatMap((m) => m.settingsSections)], [modules])

  return (
    <AppShell navItems={navItems}>
      <Routes>
        <Route index element={<Navigate to="/accueil" replace />} />
        <Route path="accueil" element={<HomePage />} />
        {/* SettingsLayout wraps each section in its own RouteBoundary. */}
        <Route
          path="parametres/*"
          element={
            <RequireAccess permission="settings.view">
              <SettingsLayout sections={settingsSections} />
            </RequireAccess>
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
  )
}
