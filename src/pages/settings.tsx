import { Save, Settings as SettingsIcon, User, Bell, Shield, Palette } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

const settingsSections = [
  { id: 'profile', label: 'Profil', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Sécurité', icon: Shield },
  { id: 'appearance', label: 'Apparence', icon: Palette },
]

export function SettingsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      {/* Toolbar: Action button */}
      <div className="flex justify-end">
        <Button disabled>
          <Save className="h-4 w-4" />
          {t('pages.settings.action')}
        </Button>
      </div>

      {/* Settings navigation */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {settingsSections.map((section, index) => {
          const Icon = section.icon
          const isActive = index === 0

          return (
            <button
              key={section.id}
              disabled
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-sage-100 text-sage-700'
                  : 'text-foreground-secondary hover:bg-background-secondary opacity-60 cursor-not-allowed'
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<SettingsIcon className="h-8 w-8" />}
          title={t('pages.settings.empty.title')}
          description={t('pages.settings.empty.description')}
        />
      ) : (
        /* Settings form skeleton */
        <div className="rounded-xl border border-border bg-background divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-5 flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="shimmer h-5 w-32 rounded" />
                <div className="shimmer h-4 w-56 rounded" />
              </div>
              <div className="shimmer h-10 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
