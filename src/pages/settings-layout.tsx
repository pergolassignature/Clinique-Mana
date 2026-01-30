// src/pages/settings-layout.tsx

import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { FileText, Briefcase, User, Bell, Shield, Palette, Building2, Tags, Clock, FileCode } from 'lucide-react'
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
  { id: 'specialties', path: '/parametres/specialites', label: 'Spécialités', icon: Tags, enabled: true },
  { id: 'services', path: '/parametres/services', label: 'Catalogue de services', icon: Briefcase, enabled: true },
  { id: 'clinique', path: '/parametres/clinique', label: 'Configuration clinique', icon: Building2, enabled: true },
  { id: 'scheduled-tasks', path: '/parametres/taches-planifiees', label: 'Tâches planifiées', icon: Clock, enabled: true },
  { id: 'templates', path: '/parametres/gabarits', label: 'Gabarits de documents', icon: FileCode, enabled: true },
  { id: 'profile', path: '/parametres/profil', label: 'Profil', icon: User, enabled: false },
  { id: 'notifications', path: '/parametres/notifications', label: 'Notifications', icon: Bell, enabled: false },
  { id: 'security', path: '/parametres/securite', label: 'Sécurité', icon: Shield, enabled: false },
  { id: 'appearance', path: '/parametres/apparence', label: 'Apparence', icon: Palette, enabled: false },
]

export function SettingsLayout() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  // Split sections into enabled and disabled for better UX
  const enabledSections = settingsSections.filter(s => s.enabled)
  const disabledSections = settingsSections.filter(s => !s.enabled)

  return (
    <div className="space-y-0">
      {/* Top navigation */}
      <nav className="border-b border-border-default bg-background-secondary/50">
        <div className="flex items-center gap-1 px-2 overflow-x-auto">
          {enabledSections.map((section) => {
            const Icon = section.icon
            const isActive = currentPath === section.path || currentPath.startsWith(section.path + '/')

            return (
              <Link
                key={section.id}
                to={section.path}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
                  isActive
                    ? 'border-sage-600 text-sage-700 bg-background'
                    : 'border-transparent text-foreground-secondary hover:text-foreground hover:border-border-default'
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-sage-600' : 'text-foreground-muted')} />
                <span>{section.label}</span>
              </Link>
            )
          })}

          {/* Disabled sections shown as muted */}
          {disabledSections.map((section) => {
            const Icon = section.icon
            return (
              <div
                key={section.id}
                className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground-muted opacity-50 cursor-not-allowed whitespace-nowrap border-b-2 border-transparent -mb-px"
              >
                <Icon className="h-4 w-4" />
                <span>{section.label}</span>
                <span className="text-xs bg-background-tertiary px-1.5 py-0.5 rounded">Bientôt</span>
              </div>
            )
          })}
        </div>
      </nav>

      {/* Main content area */}
      <Outlet />
    </div>
  )
}
