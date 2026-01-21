import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, User, Phone, MapPin, Briefcase, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/shared/ui/sheet'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { AddressAutocomplete } from '@/shared/components/address-autocomplete'
import { SearchableSelect, type SearchableSelectOption } from '@/shared/components/searchable-select'
import {
  useDuplicateDetection,
  type DuplicateMatch,
} from '@/shared/hooks/use-duplicate-detection'
import {
  buildDuplicateCheckPayload,
  isValidEmail,
  isValidCanadianPhone,
  isValidName,
} from '@/shared/lib/client-validation'
import { DuplicateWarning } from '@/shared/components/duplicate-warning'
import { useProfessionals } from '@/professionals/hooks'
import type { Sex, Language, Province } from '../types'
import type { ParsedAddress } from '@/shared/hooks/use-google-places'

// Simple error tracking type
type FormErrors = Record<string, string | undefined>

interface NewClientDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: NewClientFormData) => void
}

export interface NewClientFormData {
  // Identity
  firstName: string
  lastName: string
  sex: Sex | null
  language: Language
  birthday: string | null
  // Contact
  email: string | null
  cellPhoneCountryCode: string
  cellPhone: string | null
  homePhoneCountryCode: string
  homePhone: string | null
  workPhoneCountryCode: string
  workPhone: string | null
  workPhoneExtension: string | null
  // Address
  streetNumber: string | null
  streetName: string | null
  apartment: string | null
  city: string | null
  province: Province | null
  country: string
  postalCode: string | null
  // Admin
  referredBy: string | null
  tags: string[]
  primaryProfessionalId: string | null
}

const defaultForm: NewClientFormData = {
  firstName: '',
  lastName: '',
  sex: null,
  language: 'fr',
  birthday: null,
  email: null,
  cellPhoneCountryCode: '+1',
  cellPhone: null,
  homePhoneCountryCode: '+1',
  homePhone: null,
  workPhoneCountryCode: '+1',
  workPhone: null,
  workPhoneExtension: null,
  streetNumber: null,
  streetName: null,
  apartment: null,
  city: null,
  province: null,
  country: 'Canada',
  postalCode: null,
  referredBy: null,
  tags: [],
  primaryProfessionalId: null,
}

// Available tags
const AVAILABLE_TAGS = ['VIP', 'Nouveau', 'Famille', 'Urgent', 'Assurance']

type FormSection = 'identity' | 'contact' | 'address' | 'admin'

function getValidationErrorMessage(errorKey: string): string {
  const errorMap: Record<string, string> = {
    required: 'Ce champ est requis',
    invalidEmail: 'Adresse courriel invalide',
    invalidPhone: 'Numéro de téléphone invalide',
    invalidName: 'Nom invalide',
    invalidDateOfBirth: 'Date de naissance invalide',
  }
  return errorMap[errorKey] ?? 'Ce champ est requis'
}

// Validate a specific field
function validateFormField(field: string, value: string | null | undefined): string | undefined {
  const trimmed = (value || '').trim()

  switch (field) {
    case 'firstName':
    case 'lastName':
      if (!trimmed) return 'required'
      if (!isValidName(trimmed)) return 'invalidName'
      return undefined
    case 'email':
      if (trimmed && !isValidEmail(trimmed)) return 'invalidEmail'
      return undefined
    case 'cellPhone':
      if (trimmed && !isValidCanadianPhone(trimmed)) return 'invalidPhone'
      return undefined
    default:
      return undefined
  }
}

export function NewClientDrawer({ open, onOpenChange, onSave }: NewClientDrawerProps) {
  const [form, setForm] = useState<NewClientFormData>(defaultForm)
  const [activeSection, setActiveSection] = useState<FormSection>('identity')
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set())
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false)

  // Fetch active professionals from database
  const { data: professionals = [] } = useProfessionals({ status: 'active' })

  // Reset form when drawer opens
  useEffect(() => {
    if (open) {
      setForm(defaultForm)
      setActiveSection('identity')
      setTouchedFields(new Set())
      setFormErrors({})
      setDuplicateConfirmed(false)
    }
  }, [open])

  // Build duplicate check payload
  const duplicatePayload = useMemo(() => {
    if (!open) return null
    return buildDuplicateCheckPayload({
      firstName: form.firstName,
      lastName: form.lastName,
      dateOfBirth: form.birthday?.split('T')[0] || '',
      email: form.email || '',
      phone: form.cellPhone || '',
    })
  }, [open, form.firstName, form.lastName, form.birthday, form.email, form.cellPhone])

  // Use duplicate detection hook
  const {
    isChecking: isDuplicateChecking,
    matches: duplicateMatches,
  } = useDuplicateDetection(duplicatePayload, { enabled: open })

  const hasHighConfidenceDuplicate = duplicateMatches.some((m) => m.confidence === 'high')
  const hasMediumConfidenceDuplicate = duplicateMatches.some((m) => m.confidence === 'medium')
  const highestConfidence = duplicateMatches[0]?.confidence || 'none'

  // Handle field change with validation
  const handleFieldChange = useCallback(
    (field: keyof NewClientFormData, value: unknown) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      setDuplicateConfirmed(false)

      if (touchedFields.has(field)) {
        const error = validateFormField(field, value as string)
        setFormErrors((prev) => {
          if (!error) {
            const { [field]: _, ...rest } = prev
            return rest
          }
          return { ...prev, [field]: error }
        })
      }
    },
    [touchedFields]
  )

  // Handle field blur
  const handleFieldBlur = useCallback((field: keyof NewClientFormData) => {
    setTouchedFields((prev) => new Set(prev).add(field))
    const error = validateFormField(field, form[field] as string)
    setFormErrors((prev) => {
      if (!error) {
        const { [field]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [field]: error }
    })
  }, [form])

  // Handle address autocomplete
  const handleAddressSelect = (parsed: ParsedAddress) => {
    setForm((prev) => ({
      ...prev,
      streetNumber: parsed.streetNumber,
      streetName: parsed.streetName,
      city: parsed.city,
      province: (parsed.province as Province) || null,
      postalCode: parsed.postalCode,
    }))
  }

  // Handle duplicate selection
  const handleSelectDuplicate = (match: DuplicateMatch) => {
    // In real app, this would navigate to the existing client
    console.log('Selected existing client:', match)
    onOpenChange(false)
  }

  // Validate required fields
  const validateForm = (): boolean => {
    const errors: FormErrors = {}
    let isValid = true

    // Required fields
    const firstNameError = validateFormField('firstName', form.firstName)
    if (firstNameError) {
      errors.firstName = firstNameError
      isValid = false
    }
    const lastNameError = validateFormField('lastName', form.lastName)
    if (lastNameError) {
      errors.lastName = lastNameError
      isValid = false
    }

    // Email validation if provided
    if (form.email) {
      const emailError = validateFormField('email', form.email)
      if (emailError) {
        errors.email = emailError
        isValid = false
      }
    }

    // Phone validation if provided
    if (form.cellPhone) {
      const phoneError = validateFormField('cellPhone', form.cellPhone)
      if (phoneError) {
        errors.cellPhone = phoneError
        isValid = false
      }
    }

    setFormErrors(errors)
    return isValid
  }

  // Check if form can be submitted
  const canSubmit = useMemo(() => {
    if (!form.firstName.trim() || !form.lastName.trim()) return false
    if (Object.keys(formErrors).length > 0) return false
    if (hasHighConfidenceDuplicate) return false
    if (hasMediumConfidenceDuplicate && !duplicateConfirmed) return false
    return true
  }, [form.firstName, form.lastName, formErrors, hasHighConfidenceDuplicate, hasMediumConfidenceDuplicate, duplicateConfirmed])

  const handleSave = () => {
    if (!validateForm()) return
    if (!canSubmit) return
    onSave(form)
    onOpenChange(false)
  }

  // Professional options for SearchableSelect
  const professionalOptions: SearchableSelectOption[] = [
    { value: '', label: 'Aucun professionnel' },
    ...professionals.map((pro) => ({
      value: pro.id,
      label: pro.display_name,
    })),
  ]

  const sections: { id: FormSection; label: string; icon: typeof User }[] = [
    { id: 'identity', label: t('clients.new.sections.identity'), icon: User },
    { id: 'contact', label: t('clients.new.sections.contact'), icon: Phone },
    { id: 'address', label: t('clients.new.sections.address'), icon: MapPin },
    { id: 'admin', label: t('clients.new.sections.admin'), icon: Briefcase },
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-hidden p-0 flex flex-col"
      >
        <VisuallyHidden>
          <SheetTitle>{t('clients.new.title')}</SheetTitle>
          <SheetDescription>{t('clients.new.description')}</SheetDescription>
        </VisuallyHidden>

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{t('clients.new.title')}</h2>
            <p className="text-sm text-foreground-muted">{t('clients.new.description')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-border px-6">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeSection === section.id
                    ? 'border-sage-500 text-sage-700'
                    : 'border-transparent text-foreground-muted hover:text-foreground hover:border-border'
                )}
              >
                <Icon className="h-4 w-4" />
                {section.label}
              </button>
            )
          })}
        </div>

        {/* Form content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Identity Section */}
          {activeSection === 'identity' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    {t('clients.new.fields.firstName')} <span className="text-wine-500">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) => handleFieldChange('firstName', e.target.value)}
                    onBlur={() => handleFieldBlur('firstName')}
                    className={cn(formErrors.firstName && touchedFields.has('firstName') && 'border-wine-300')}
                  />
                  {formErrors.firstName && touchedFields.has('firstName') && (
                    <p className="text-xs text-wine-600">{getValidationErrorMessage(formErrors.firstName)}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    {t('clients.new.fields.lastName')} <span className="text-wine-500">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) => handleFieldChange('lastName', e.target.value)}
                    onBlur={() => handleFieldBlur('lastName')}
                    className={cn(formErrors.lastName && touchedFields.has('lastName') && 'border-wine-300')}
                  />
                  {formErrors.lastName && touchedFields.has('lastName') && (
                    <p className="text-xs text-wine-600">{getValidationErrorMessage(formErrors.lastName)}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sex">{t('clients.new.fields.sex')}</Label>
                  <Select
                    id="sex"
                    value={form.sex || ''}
                    onChange={(e) => handleFieldChange('sex', e.target.value || null)}
                  >
                    <option value="">Non specifie</option>
                    <option value="male">{t('clients.sex.male')}</option>
                    <option value="female">{t('clients.sex.female')}</option>
                    <option value="other">{t('clients.sex.other')}</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">{t('clients.new.fields.language')}</Label>
                  <Select
                    id="language"
                    value={form.language}
                    onChange={(e) => handleFieldChange('language', e.target.value)}
                  >
                    <option value="fr">Francais</option>
                    <option value="en">English</option>
                    <option value="other">Autre</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="birthday">{t('clients.new.fields.birthday')}</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={form.birthday?.split('T')[0] || ''}
                  onChange={(e) => handleFieldChange('birthday', e.target.value ? `${e.target.value}T00:00:00.000Z` : null)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
          )}

          {/* Contact Section */}
          {activeSection === 'contact' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('clients.new.fields.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => handleFieldChange('email', e.target.value || null)}
                  onBlur={() => handleFieldBlur('email')}
                  placeholder="courriel@exemple.com"
                  className={cn(formErrors.email && touchedFields.has('email') && 'border-wine-300')}
                />
                {formErrors.email && touchedFields.has('email') && (
                  <p className="text-xs text-wine-600">{getValidationErrorMessage(formErrors.email)}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('clients.new.fields.cellPhone')}</Label>
                <div className="flex gap-2">
                  <Input
                    className="w-20"
                    value={form.cellPhoneCountryCode}
                    onChange={(e) => handleFieldChange('cellPhoneCountryCode', e.target.value)}
                    placeholder="+1"
                  />
                  <Input
                    className={cn('flex-1', formErrors.cellPhone && touchedFields.has('cellPhone') && 'border-wine-300')}
                    value={form.cellPhone || ''}
                    onChange={(e) => handleFieldChange('cellPhone', e.target.value || null)}
                    onBlur={() => handleFieldBlur('cellPhone')}
                    placeholder="514-555-0100"
                  />
                </div>
                {formErrors.cellPhone && touchedFields.has('cellPhone') && (
                  <p className="text-xs text-wine-600">{getValidationErrorMessage(formErrors.cellPhone)}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('clients.new.fields.homePhone')}</Label>
                <div className="flex gap-2">
                  <Input
                    className="w-20"
                    value={form.homePhoneCountryCode}
                    onChange={(e) => handleFieldChange('homePhoneCountryCode', e.target.value)}
                    placeholder="+1"
                  />
                  <Input
                    className="flex-1"
                    value={form.homePhone || ''}
                    onChange={(e) => handleFieldChange('homePhone', e.target.value || null)}
                    placeholder="514-555-0100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('clients.new.fields.workPhone')}</Label>
                <div className="flex gap-2">
                  <Input
                    className="w-20"
                    value={form.workPhoneCountryCode}
                    onChange={(e) => handleFieldChange('workPhoneCountryCode', e.target.value)}
                    placeholder="+1"
                  />
                  <Input
                    className="flex-1"
                    value={form.workPhone || ''}
                    onChange={(e) => handleFieldChange('workPhone', e.target.value || null)}
                    placeholder="514-555-0100"
                  />
                  <Input
                    className="w-20"
                    value={form.workPhoneExtension || ''}
                    onChange={(e) => handleFieldChange('workPhoneExtension', e.target.value || null)}
                    placeholder="ext."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Address Section */}
          {activeSection === 'address' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('clients.new.fields.addressSearch')}</Label>
                <AddressAutocomplete
                  onAddressSelect={handleAddressSelect}
                  placeholder="Rechercher une adresse..."
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-foreground-muted">
                    ou saisir manuellement
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="streetNumber">{t('clients.new.fields.streetNumber')}</Label>
                  <Input
                    id="streetNumber"
                    value={form.streetNumber || ''}
                    onChange={(e) => handleFieldChange('streetNumber', e.target.value || null)}
                    placeholder="123"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="streetName">{t('clients.new.fields.streetName')}</Label>
                  <Input
                    id="streetName"
                    value={form.streetName || ''}
                    onChange={(e) => handleFieldChange('streetName', e.target.value || null)}
                    placeholder="Rue Exemple"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="apartment">{t('clients.new.fields.apartment')}</Label>
                <Input
                  id="apartment"
                  value={form.apartment || ''}
                  onChange={(e) => handleFieldChange('apartment', e.target.value || null)}
                  placeholder="Appartement, suite, etc."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">{t('clients.new.fields.city')}</Label>
                  <Input
                    id="city"
                    value={form.city || ''}
                    onChange={(e) => handleFieldChange('city', e.target.value || null)}
                    placeholder="Montreal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="province">{t('clients.new.fields.province')}</Label>
                  <Select
                    id="province"
                    value={form.province || ''}
                    onChange={(e) => handleFieldChange('province', e.target.value || null)}
                  >
                    <option value="">Selectionner...</option>
                    <option value="QC">Quebec</option>
                    <option value="ON">Ontario</option>
                    <option value="BC">Colombie-Britannique</option>
                    <option value="AB">Alberta</option>
                    <option value="MB">Manitoba</option>
                    <option value="SK">Saskatchewan</option>
                    <option value="NS">Nouvelle-Ecosse</option>
                    <option value="NB">Nouveau-Brunswick</option>
                    <option value="NL">Terre-Neuve-et-Labrador</option>
                    <option value="PE">Ile-du-Prince-Edouard</option>
                    <option value="NT">Territoires du Nord-Ouest</option>
                    <option value="YT">Yukon</option>
                    <option value="NU">Nunavut</option>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="postalCode">{t('clients.new.fields.postalCode')}</Label>
                  <Input
                    id="postalCode"
                    value={form.postalCode || ''}
                    onChange={(e) => handleFieldChange('postalCode', e.target.value || null)}
                    placeholder="H2X 1Y4"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">{t('clients.new.fields.country')}</Label>
                  <Input
                    id="country"
                    value="Canada"
                    disabled
                    className="bg-background-secondary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Admin Section */}
          {activeSection === 'admin' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('clients.new.fields.primaryProfessional')}</Label>
                <SearchableSelect
                  options={professionalOptions}
                  value={form.primaryProfessionalId || ''}
                  onValueChange={(value) => handleFieldChange('primaryProfessionalId', value || null)}
                  placeholder="Selectionner un professionnel..."
                  searchPlaceholder="Rechercher..."
                  emptyMessage="Aucun professionnel trouve."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="referredBy">{t('clients.new.fields.referredBy')}</Label>
                <Input
                  id="referredBy"
                  value={form.referredBy || ''}
                  onChange={(e) => handleFieldChange('referredBy', e.target.value || null)}
                  placeholder="Source de reference..."
                />
              </div>

              <div className="space-y-2">
                <Label>{t('clients.new.fields.tags')}</Label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const newTags = form.tags.includes(tag)
                          ? form.tags.filter((t) => t !== tag)
                          : [...form.tags, tag]
                        handleFieldChange('tags', newTags)
                      }}
                      className={cn(
                        'px-3 py-1 text-sm rounded-full border transition-colors',
                        form.tags.includes(tag)
                          ? 'bg-sage-100 border-sage-300 text-sage-700'
                          : 'border-border hover:bg-background-secondary'
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Duplicate Detection */}
          {isDuplicateChecking && (
            <div className="mt-4 flex items-center gap-2 text-sm text-foreground-muted py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verification des doublons...
            </div>
          )}

          {duplicateMatches.length > 0 && !isDuplicateChecking && (
            <div className="mt-4">
              <DuplicateWarning
                matches={duplicateMatches}
                highestConfidence={highestConfidence}
                onSelectClient={handleSelectDuplicate}
                confirmed={duplicateConfirmed}
                onConfirmChange={
                  hasMediumConfidenceDuplicate && !hasHighConfidenceDuplicate
                    ? setDuplicateConfirmed
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border bg-background-secondary">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit || isDuplicateChecking}>
            {isDuplicateChecking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('clients.new.save')
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
