import { createElement, Suspense } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import type { SettingsGroup, SettingsSection } from '@/core/modules/types'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { SETTINGS_BASE_PATH, settingsSectionPath } from './paths'

const GROUP_ORDER: SettingsGroup[] = ['clinique', 'plateforme', 'modules', 'compte']

const sectionScope = (s: SettingsSection) => (s.moduleKey ? `settings:${s.moduleKey}:${s.id}` : `settings:${s.id}`)

interface SettingsLayoutProps {
  sections: SettingsSection[]
  /** Where the layout is mounted (under a splat route, e.g. `parametres/*`). Menu links are absolute. */
  basePath?: string
}

/**
 * Settings shell: a grouped side menu and one nested route per section the user can access.
 * Each section has its own error boundary, so a crashing section leaves the menu usable.
 */
export function SettingsLayout({ sections, basePath = SETTINGS_BASE_PATH }: SettingsLayoutProps) {
  usePageTitle(t('pageTitles.settings'))
  const { can } = useAccess()
  const visible = sections.filter((s) => can(s.permission))
  const first = visible[0]

  const title = <h1 className="mb-5 text-xl font-semibold tracking-tight">{t('settings.title')}</h1>

  if (!first) {
    return (
      <div>
        {title}
        <FullPageMessage title={t('settings.empty')} headingLevel={2} compact />
      </div>
    )
  }

  return (
    <div>
      {title}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label={t('settings.navLabel')} className="md:w-56 md:shrink-0">
          {GROUP_ORDER.map((group) => {
            const items = visible.filter((s) => s.group === group)
            if (items.length === 0) return null
            const headingId = `settings-group-${group}`
            return (
              <div key={group} role="group" aria-labelledby={headingId} className="mb-3">
                <p id={headingId} className="mb-0.5 px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(`settings.groups.${group}`)}
                </p>
                {items.map((s) => (
                  <NavLink
                    key={s.id}
                    to={settingsSectionPath(s, basePath)}
                    className={({ isActive }) =>
                      cn(
                        `flex items-center gap-2 rounded-md px-2 py-[5px] text-sm transition-colors duration-120 ${focusRing}`,
                        isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <s.icon className="h-3.5 w-3.5 text-subtle" aria-hidden />
                    {t(s.labelKey)}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <section className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to={first.id} replace />} />
            {visible.map((s) => (
              <Route
                key={s.id}
                path={s.id}
                element={
                  <RouteBoundary scope={sectionScope(s)} compact>
                    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
                      {createElement(s.component)}
                    </Suspense>
                  </RouteBoundary>
                }
              />
            ))}
            <Route
              path="*"
              element={<FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} headingLevel={2} compact />}
            />
          </Routes>
        </section>
      </div>
    </div>
  )
}
