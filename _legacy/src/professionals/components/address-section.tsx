import { useState } from 'react'
import { MapPin, Edit3, X, Check, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { AddressAutocomplete } from '@/shared/components/address-autocomplete'
import type { ParsedAddress } from '@/shared/hooks/use-google-places'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { useToast } from '@/shared/hooks/use-toast'

export interface AddressData {
  street_number: string | null
  street_name: string | null
  apartment: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
}

interface AddressSectionProps {
  streetNumber?: string
  streetName?: string
  apartment?: string
  city?: string
  province?: string
  postalCode?: string
  country?: string
  formattedAddress?: string
  hasAddress: boolean
  onSave: (address: AddressData) => Promise<void>
  isSaving?: boolean
  /** When true, renders without Card wrapper for embedding in another Card */
  inline?: boolean
  /** When true, renders without header/icon (for use when icon is provided externally) */
  compact?: boolean
}

export function AddressSection({
  streetNumber,
  streetName,
  apartment,
  city,
  province,
  postalCode,
  country,
  formattedAddress,
  hasAddress,
  onSave,
  isSaving,
  inline = false,
  compact = false,
}: AddressSectionProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<AddressData>({
    street_number: streetNumber || null,
    street_name: streetName || null,
    apartment: apartment || null,
    city: city || null,
    province: province || null,
    postal_code: postalCode || null,
    country: country || 'Canada',
  })
  const { toast } = useToast()

  const handleAddressSelect = (parsed: ParsedAddress) => {
    setForm({
      street_number: parsed.streetNumber,
      street_name: parsed.streetName,
      apartment: form.apartment, // Keep existing apartment
      city: parsed.city,
      province: parsed.province,
      postal_code: parsed.postalCode,
      country: parsed.country || 'Canada',
    })
  }

  const handleFieldChange = (field: keyof AddressData, value: string | null) => {
    setForm((prev) => ({ ...prev, [field]: value || null }))
  }

  const handleSave = async () => {
    try {
      await onSave(form)
      setIsEditing(false)
      toast({
        title: t('professionals.detail.profile.address.toast.updated.title'),
        description: t('professionals.detail.profile.address.toast.updated.description'),
      })
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.profile.toast.error.description'),
        variant: 'error',
      })
    }
  }

  const handleCancel = () => {
    setForm({
      street_number: streetNumber || null,
      street_name: streetName || null,
      apartment: apartment || null,
      city: city || null,
      province: province || null,
      postal_code: postalCode || null,
      country: country || 'Canada',
    })
    setIsEditing(false)
  }

  const handleStartEdit = () => {
    setForm({
      street_number: streetNumber || null,
      street_name: streetName || null,
      apartment: apartment || null,
      city: city || null,
      province: province || null,
      postal_code: postalCode || null,
      country: country || 'Canada',
    })
    setIsEditing(true)
  }

  // Shared content for both inline and card modes
  const addressContent = isEditing ? (
    <div className="space-y-4">
      {/* Address Autocomplete */}
      <div className="space-y-2">
        <Label>{t('professionals.detail.profile.address.search')}</Label>
        <AddressAutocomplete
          onAddressSelect={handleAddressSelect}
          placeholder={t('professionals.detail.profile.address.searchPlaceholder')}
        />
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-foreground-muted">
            {t('professionals.detail.profile.address.manualEntry')}
          </span>
        </div>
      </div>

      {/* Manual Entry Fields */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-2">
          <Label htmlFor="streetNumber">
            {t('professionals.detail.profile.address.fields.streetNumber')}
          </Label>
          <Input
            id="streetNumber"
            value={form.street_number || ''}
            onChange={(e) => handleFieldChange('street_number', e.target.value)}
            placeholder="123"
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="streetName">
            {t('professionals.detail.profile.address.fields.streetName')}
          </Label>
          <Input
            id="streetName"
            value={form.street_name || ''}
            onChange={(e) => handleFieldChange('street_name', e.target.value)}
            placeholder="Rue Exemple"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apartment">
          {t('professionals.detail.profile.address.fields.apartment')}
        </Label>
        <Input
          id="apartment"
          value={form.apartment || ''}
          onChange={(e) => handleFieldChange('apartment', e.target.value)}
          placeholder="Appartement, suite, etc."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="city">
            {t('professionals.detail.profile.address.fields.city')}
          </Label>
          <Input
            id="city"
            value={form.city || ''}
            onChange={(e) => handleFieldChange('city', e.target.value)}
            placeholder="Montréal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="province">
            {t('professionals.detail.profile.address.fields.province')}
          </Label>
          <Select
            id="province"
            value={form.province || ''}
            onChange={(e) => handleFieldChange('province', e.target.value)}
          >
            <option value="">Sélectionner...</option>
            <option value="QC">Québec</option>
            <option value="ON">Ontario</option>
            <option value="BC">Colombie-Britannique</option>
            <option value="AB">Alberta</option>
            <option value="MB">Manitoba</option>
            <option value="SK">Saskatchewan</option>
            <option value="NS">Nouvelle-Écosse</option>
            <option value="NB">Nouveau-Brunswick</option>
            <option value="NL">Terre-Neuve-et-Labrador</option>
            <option value="PE">Île-du-Prince-Édouard</option>
            <option value="NT">Territoires du Nord-Ouest</option>
            <option value="YT">Yukon</option>
            <option value="NU">Nunavut</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalCode">
            {t('professionals.detail.profile.address.fields.postalCode')}
          </Label>
          <Input
            id="postalCode"
            value={form.postal_code || ''}
            onChange={(e) => handleFieldChange('postal_code', e.target.value)}
            placeholder="H2X 1Y4"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">
            {t('professionals.detail.profile.address.fields.country')}
          </Label>
          <Input
            id="country"
            value="Canada"
            disabled
            className="bg-background-secondary"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isSaving}
        >
          <X className="h-4 w-4 mr-1" />
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-1" />
          )}
          {t('common.save')}
        </Button>
      </div>
    </div>
  ) : (
    <div className="group">
      <div className="flex items-start gap-2">
        {hasAddress && formattedAddress ? (
          <p className="text-sm text-foreground whitespace-pre-line">
            {formattedAddress}
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">
            {t('professionals.detail.profile.address.empty')}
          </p>
        )}
        <button
          onClick={handleStartEdit}
          className="opacity-0 transition-opacity group-hover:opacity-100 shrink-0"
          aria-label={t('professionals.detail.profile.editLabel').replace('{label}', '')}
        >
          <Edit3 className="h-3.5 w-3.5 text-foreground-muted hover:text-foreground" />
        </button>
      </div>
    </div>
  )

  // Inline mode: just render the content with a header
  if (inline) {
    // Compact mode: no header, just the content (icon provided externally)
    if (compact) {
      return (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground-muted">
            {t('professionals.detail.profile.address.title')}
          </p>
          {addressContent}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sage-600" />
            <p className="text-xs font-medium text-foreground-muted">
              {t('professionals.detail.profile.address.title')}
            </p>
          </div>
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className="opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
              aria-label={t('professionals.detail.profile.editLabel').replace('{label}', '')}
            >
              <Edit3 className="h-3.5 w-3.5 text-foreground-muted hover:text-foreground" />
            </button>
          )}
        </div>
        {addressContent}
      </div>
    )
  }

  // Card mode: wrap in Card components
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sage-600" />
            <CardTitle className="text-base">
              {t('professionals.detail.profile.address.title')}
            </CardTitle>
          </div>
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className="opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
              aria-label={t('professionals.detail.profile.editLabel').replace('{label}', '')}
            >
              <Edit3 className="h-4 w-4 text-foreground-muted hover:text-foreground" />
            </button>
          )}
        </div>
        <CardDescription>
          {t('professionals.detail.profile.address.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {addressContent}
      </CardContent>
    </Card>
  )
}
