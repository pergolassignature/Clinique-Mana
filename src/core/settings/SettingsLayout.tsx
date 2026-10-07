import { createElement, Suspense } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import type { SettingsGroup, SettingsSection } from '@/core/modules/types'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { cn } from '@/shared/lib/utils'

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
export function SettingsLayout({ sections, basePath = '/parametres' }: SettingsLayoutProps) {
  const { can } = useAccess()
  const visible = sections.filter((s) => can(s.permission))
  const first = visible[0]

  if (!first) return <FullPageMessage title={t('settings.title')} body={t('settings.empty')} />

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="md:w-56 md:shrink-0">
        <h1 className="mb-4 text-xl font-semibold">{t('settings.title')}</h1>
        {GROUP_ORDER.map((group) => {
          const items = visible.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="mb-4">
              <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`settings.groups.${group}`)}</p>
              {items.map((s) => (
                <NavLink
                  key={s.id}
                  to={`${basePath}/${s.id}`}
                  className={({ isActive }) =>
                    cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')
                  }
                >
                  <s.icon className="h-4 w-4" aria-hidden />
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
                <RouteBoundary scope={sectionScope(s)}>
                  <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
                    {createElement(s.component)}
                  </Suspense>
                </RouteBoundary>
              }
            />
          ))}
          <Route path="*" element={<FullPageMessage title={t('common.notFound.title')} body={t('common.notFound.body')} />} />
        </Routes>
      </section>
    </div>
  )
}
