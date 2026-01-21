import { useState, useEffect } from 'react'
import { Save, Settings as SettingsIcon, User, Bell, Shield, Palette, Building2, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { cn } from '@/shared/lib/utils'
import { useToast } from '@/shared/hooks/use-toast'
import { useClinicSettings, useUpdateClinicSettings } from '@/external-payers'

type SettingsSection = 'clinic' | 'profile' | 'notifications' | 'security' | 'appearance'

const settingsSections: { id: SettingsSection; label: string; icon: typeof User; enabled: boolean }[] = [
  { id: 'clinic', label: 'Clinique', icon: Building2, enabled: true },
  { id: 'profile', label: 'Profil', icon: User, enabled: false },
  { id: 'notifications', label: 'Notifications', icon: Bell, enabled: false },
  { id: 'security', label: 'Securite', icon: Shield, enabled: false },
  { id: 'appearance', label: 'Apparence', icon: Palette, enabled: false },
]

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('clinic')

  return (
    <div className="space-y-6">
      {/* Settings navigation */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {settingsSections.map((section) => {
          const Icon = section.icon
          const isActive = section.id === activeSection

          return (
            <button
              key={section.id}
              onClick={() => section.enabled && setActiveSection(section.id)}
              disabled={!section.enabled}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-sage-100 text-sage-700'
                  : section.enabled
                    ? 'text-foreground-secondary hover:bg-background-secondary'
                    : 'text-foreground-secondary opacity-60 cursor-not-allowed'
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {activeSection === 'clinic' ? (
        <ClinicSettingsSection />
      ) : (
        <EmptyState
          icon={<SettingsIcon className="h-8 w-8" />}
          title={t('pages.settings.empty.title')}
          description={t('pages.settings.empty.description')}
        />
      )}
    </div>
  )
}

function ClinicSettingsSection() {
  const { data: settings, isLoading } = useClinicSettings()
  const updateSettings = useUpdateClinicSettings()
  const { toast } = useToast()

  const [ivacProviderNumber, setIvacProviderNumber] = useState('')

  useEffect(() => {
    if (settings) {
      setIvacProviderNumber(settings.ivac_provider_number || '')
    }
  }, [settings])

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        ivac_provider_number: ivacProviderNumber.trim() || null,
      })
      toast({
        title: 'Parametres enregistres',
        description: 'Les parametres de la clinique ont ete mis a jour.',
      })
    } catch (err) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer les parametres.',
        variant: 'error',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* IVAC Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sage-600" />
            <CardTitle>{t('settings.clinic.ivacTitle')}</CardTitle>
          </div>
          <CardDescription>
            {t('settings.clinic.ivacDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ivac_provider_number">
              {t('settings.clinic.ivacProviderNumber')}
            </Label>
            <Input
              id="ivac_provider_number"
              value={ivacProviderNumber}
              onChange={(e) => setIvacProviderNumber(e.target.value)}
              placeholder="Ex: IVAC-CLINIC-123456"
              className="max-w-md"
            />
            <p className="text-xs text-foreground-muted">
              {t('settings.clinic.ivacProviderHint')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
