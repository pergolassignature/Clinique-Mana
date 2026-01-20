// src/pages/settings-layout.tsx

import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { FileText, Briefcase, User, Bell, Shield, Palette } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface SettingsSection {
  id: string
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  enabled: boolean
}

const settingsSections: SettingsSection[] = [
  { id: 'motifs', path: '/parametres/motifs', label: 'Motifs de consultation', icon: FileText, enabled: true },
  { id: 'services', path: '/parametres/services', label: 'Catalogue de services', icon: Briefcase, enabled: true },
  { id: 'profile', path: '/parametres/profil', label: 'Profil', icon: User, enabled: false },
  { id: 'notifications', path: '/parametres/notifications', label: 'Notifications', icon: Bell, enabled: false },
  { id: 'security', path: '/parametres/securite', label: 'Sécurité', icon: Shield, enabled: false },
  { id: 'appearance', path: '/parametres/apparence', label: 'Apparence', icon: Palette, enabled: false },
]

export function SettingsLayout() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <div className="flex gap-6 h-full">
      {/* Settings sidebar */}
      <aside className="w-64 flex-shrink-0">
        <nav className="space-y-1">
          {settingsSections.map((section) => {
            const Icon = section.icon
            const isActive = currentPath === section.path || currentPath.startsWith(section.path + '/')

            if (!section.enabled) {
              return (
                <div
                  key={section.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground-muted opacity-50 cursor-not-allowed"
                >
                  <Icon className="h-5 w-5" />
                  <span>{section.label}</span>
                  <span className="ml-auto text-xs bg-background-tertiary px-2 py-0.5 rounded">Bientôt</span>
                </div>
              )
            }

            return (
              <Link
                key={section.id}
                to={section.path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sage-100 text-sage-700'
                    : 'text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive ? 'text-sage-600' : 'text-foreground-muted')} />
                <span>{section.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content area */}
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
