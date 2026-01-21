// src/pages/clinic-settings.tsx

import { useState, useEffect } from 'react'
import { Save, Building2, Loader2, Clock } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Select } from '@/shared/ui/select'
import { useToast } from '@/shared/hooks/use-toast'
import { useClinicSettings, useUpdateClinicSettings } from '@/external-payers'

// Common North American timezones for clinics
const TIMEZONE_OPTIONS = [
  { value: 'America/Toronto', label: 'EST/EDT - Toronto, Montréal (America/Toronto)' },
  { value: 'America/New_York', label: 'EST/EDT - New York (America/New_York)' },
  { value: 'America/Chicago', label: 'CST/CDT - Chicago (America/Chicago)' },
  { value: 'America/Denver', label: 'MST/MDT - Denver (America/Denver)' },
  { value: 'America/Los_Angeles', label: 'PST/PDT - Los Angeles (America/Los_Angeles)' },
  { value: 'America/Vancouver', label: 'PST/PDT - Vancouver (America/Vancouver)' },
]

export function ClinicSettingsPage() {
  const { data: settings, isLoading } = useClinicSettings()
  const updateSettings = useUpdateClinicSettings()
  const { toast } = useToast()

  const [ivacProviderNumber, setIvacProviderNumber] = useState('')
  const [timezone, setTimezone] = useState('America/Toronto')

  useEffect(() => {
    if (settings) {
      setIvacProviderNumber(settings.ivac_provider_number || '')
      setTimezone(settings.timezone || 'America/Toronto')
    }
  }, [settings])

  const handleSaveIvac = async () => {
    try {
      await updateSettings.mutateAsync({
        ivac_provider_number: ivacProviderNumber.trim() || null,
      })
      toast({
        title: 'Parametres enregistres',
        description: 'Le numéro de fournisseur IVAC a été mis à jour.',
      })
    } catch (err) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer les parametres.',
        variant: 'error',
      })
    }
  }

  const handleSaveTimezone = async () => {
    try {
      await updateSettings.mutateAsync({
        timezone,
      })
      toast({
        title: 'Fuseau horaire enregistré',
        description: 'Le fuseau horaire de la clinique a été mis à jour.',
      })
    } catch (err) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer le fuseau horaire.',
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
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configuration clinique</h1>
        <p className="text-sm text-foreground-secondary mt-1">
          Parametres generaux de la clinique
        </p>
      </div>

      {/* IVAC Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sage-600" />
            <CardTitle>IVAC - Numéro de fournisseur</CardTitle>
          </div>
          <CardDescription>
            Configurez le numéro de fournisseur IVAC de la clinique. Ce numéro sera affiché dans les dossiers IVAC des clients.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ivac_provider_number">
              Numéro de fournisseur IVAC
            </Label>
            <Input
              id="ivac_provider_number"
              value={ivacProviderNumber}
              onChange={(e) => setIvacProviderNumber(e.target.value)}
              placeholder="Ex: IVAC-CLINIC-123456"
              className="max-w-md"
            />
            <p className="text-xs text-foreground-muted">
              Ce numéro est fourni par l'IVAC lors de l'inscription de la clinique comme fournisseur de services.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveIvac} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Timezone Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-sage-600" />
            <CardTitle>Fuseau horaire</CardTitle>
          </div>
          <CardDescription>
            Configurez le fuseau horaire de la clinique. Toutes les dates et heures seront affichées selon ce fuseau horaire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timezone">
              Fuseau horaire de la clinique
            </Label>
            <Select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="max-w-md"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-foreground-muted">
              Le fuseau horaire EST/EDT (America/Toronto) est recommandé pour les cliniques au Québec.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveTimezone} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
