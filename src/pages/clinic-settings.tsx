// src/pages/clinic-settings.tsx

import { useState, useEffect } from 'react'
import { Save, Building2, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { useToast } from '@/shared/hooks/use-toast'
import { useClinicSettings, useUpdateClinicSettings } from '@/external-payers'

export function ClinicSettingsPage() {
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
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
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
