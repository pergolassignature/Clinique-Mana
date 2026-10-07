import { useState } from 'react'
import {
  Award,
  Calendar,
  Edit3,
  X,
  Check,
  Loader2,
  GraduationCap,
  Building2,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateFull } from '@/shared/lib/timezone'
import { formatPhoneForDisplay } from '@/shared/lib/client-validation'
import type { ProfessionalWithRelations } from '../types'
import { useUpdateProfessional } from '../hooks'
import {
  useProfessionalIvacNumber,
  useUpsertProfessionalIvacNumber,
  useDeleteProfessionalIvacNumber,
} from '@/external-payers'
import { ProfessionEditor } from './profession-editor'
import { AddressSection, type AddressData } from './address-section'
import { mapProfessionalToViewModel } from '../mappers'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useToast } from '@/shared/hooks/use-toast'

interface ProfessionalProfileTabProps {
  professional: ProfessionalWithRelations
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return formatClinicDateFull(dateStr)
}

interface EditableFieldProps {
  label: string
  value: string | null | undefined
  onSave: (value: string) => Promise<void>
  isSaving?: boolean
  placeholder?: string
  type?: 'text' | 'email' | 'tel' | 'number'
  readOnly?: boolean
  hint?: string
}

function EditableField({
  label,
  value,
  onSave,
  isSaving,
  placeholder,
  type = 'text',
  readOnly,
  hint,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '')
  const { toast } = useToast()

  const handleSave = async () => {
    try {
      await onSave(editValue)
      setIsEditing(false)
      toast({
        title: t('professionals.detail.profile.toast.updated.title'),
        description: `${label} ${t('professionals.detail.profile.toast.updated.description').replace('{field}', '')}`,
      })
    } catch (err) {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.profile.toast.error.description'),
        variant: 'error',
      })
    }
  }

  const handleCancel = () => {
    setEditValue(value || '')
    setIsEditing(false)
  }

  if (readOnly) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground-muted">{label}</p>
        <p className="text-sm text-foreground">{value || '—'}</p>
        {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
      </div>
    )
  }

  if (isEditing) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground-muted">{label}</p>
        <div className="flex items-center gap-2">
          <Input
            type={type}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            className="h-8 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSave}
            disabled={isSaving}
            className="h-8 w-8 p-0"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4 text-sage-600" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            disabled={isSaving}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4 text-foreground-muted" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group space-y-1">
      <p className="text-xs font-medium text-foreground-muted">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-sm text-foreground">{value || '—'}</p>
        <button
          onClick={() => {
            setEditValue(value || '')
            setIsEditing(true)
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`${t('professionals.detail.profile.editLabel').replace('{label}', '')} ${label}`}
        >
          <Edit3 className="h-3.5 w-3.5 text-foreground-muted hover:text-foreground" />
        </button>
      </div>
    </div>
  )
}

// Contact row component for iOS-style contact card
interface ContactRowProps {
  icon: React.ReactNode
  label: string
  value: string | null | undefined
  onSave?: (value: string) => Promise<void>
  isSaving?: boolean
  placeholder?: string
  type?: 'text' | 'email' | 'tel'
  multiline?: boolean
  readOnly?: boolean
}

function ContactRow({
  icon,
  label,
  value,
  onSave,
  isSaving,
  placeholder,
  type = 'text',
  multiline,
  readOnly,
}: ContactRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '')
  const { toast } = useToast()

  const handleSave = async () => {
    if (!onSave) return
    try {
      await onSave(editValue)
      setIsEditing(false)
      toast({
        title: t('professionals.detail.profile.toast.updated.title'),
        description: t('professionals.detail.profile.toast.updated.description').replace('{field}', label),
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
    setEditValue(value || '')
    setIsEditing(false)
  }

  if (isEditing && onSave) {
    return (
      <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
        <div className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center text-sage-500">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-medium text-foreground-muted">{label}</p>
          <div className="flex items-center gap-2">
            <Input
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !multiline) handleSave()
                if (e.key === 'Escape') handleCancel()
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSave}
              disabled={isSaving}
              className="h-8 w-8 shrink-0 p-0"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4 text-sage-600" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isSaving}
              className="h-8 w-8 shrink-0 p-0"
            >
              <X className="h-4 w-4 text-foreground-muted" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sage-500">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground-muted">{label}</p>
        {multiline && value ? (
          <p className="whitespace-pre-line text-sm text-foreground">{value}</p>
        ) : (
          <p className="text-sm text-foreground">{value || '—'}</p>
        )}
      </div>
      {onSave && !readOnly && (
        <button
          onClick={() => {
            setEditValue(value || '')
            setIsEditing(true)
          }}
          className="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`${t('professionals.detail.profile.editLabel').replace('{label}', '')} ${label}`}
        >
          <Edit3 className="h-3.5 w-3.5 text-foreground-muted hover:text-foreground" />
        </button>
      )}
    </div>
  )
}

export function ProfessionalProfileTab({ professional }: ProfessionalProfileTabProps) {
  const updateProfessional = useUpdateProfessional()
  const viewModel = mapProfessionalToViewModel(professional)

  // IVAC number management
  const { data: ivacNumber } = useProfessionalIvacNumber(professional.id)
  const upsertIvacNumber = useUpsertProfessionalIvacNumber()
  const deleteIvacNumber = useDeleteProfessionalIvacNumber()

  const handleYearsExperienceUpdate = async (value: string) => {
    const numValue = value ? parseInt(value, 10) : null
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: { years_experience: numValue },
    })
  }

  const handleIvacNumberUpdate = async (value: string) => {
    if (value.trim()) {
      await upsertIvacNumber.mutateAsync({
        professional_id: professional.id,
        ivac_number: value.trim(),
      })
    } else if (ivacNumber) {
      await deleteIvacNumber.mutateAsync(professional.id)
    }
  }

  const handleAddressUpdate = async (address: AddressData) => {
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: address,
    })
  }

  const handlePhoneUpdate = async (value: string) => {
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: { phone_number: value || null },
    })
  }

  return (
    <div className="space-y-6">
      {/* Coordonnées Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('professionals.detail.profile.contact.title')}</CardTitle>
          <CardDescription>{t('professionals.detail.profile.contact.description')}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y">
            {/* Email */}
            <ContactRow
              icon={<Mail className="h-4 w-4" />}
              label={t('professionals.detail.profile.identity.email')}
              value={viewModel.email}
              readOnly
            />

            {/* Phone */}
            <ContactRow
              icon={<Phone className="h-4 w-4" />}
              label={t('professionals.detail.profile.identity.phone')}
              value={formatPhoneForDisplay(viewModel.phoneNumber) || viewModel.phoneNumber}
              onSave={handlePhoneUpdate}
              isSaving={updateProfessional.isPending}
              placeholder={t('professionals.detail.profile.identity.phonePlaceholder')}
              type="tel"
            />

            {/* Address */}
            <div className="group flex items-start gap-3 py-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sage-500">
                <MapPin className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <AddressSection
                  streetNumber={viewModel.streetNumber}
                  streetName={viewModel.streetName}
                  apartment={viewModel.apartment}
                  city={viewModel.city}
                  province={viewModel.province}
                  postalCode={viewModel.postalCode}
                  country={viewModel.country}
                  formattedAddress={viewModel.formattedAddress}
                  hasAddress={viewModel.hasAddress}
                  onSave={handleAddressUpdate}
                  isSaving={updateProfessional.isPending}
                  inline
                  compact
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profession Titles Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-sage-600" />
            <CardTitle className="text-base">{t('professionals.detail.profile.professionTitles.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('professionals.detail.profile.professionTitles.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessionEditor
            professionalId={professional.id}
            professions={professional.professions || []}
          />
        </CardContent>
      </Card>

      {/* Professional Info Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-sage-600" />
            <CardTitle className="text-base">{t('professionals.detail.profile.accreditation.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('professionals.detail.profile.accreditation.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditableField
            label={t('professionals.detail.profile.accreditation.yearsExperience')}
            value={viewModel.yearsExperience?.toString() || null}
            onSave={handleYearsExperienceUpdate}
            isSaving={updateProfessional.isPending}
            placeholder="Ex: 5"
            type="number"
          />
        </CardContent>
      </Card>

      {/* IVAC Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-sage-600" />
            <CardTitle className="text-base">{t('professionals.detail.profile.ivac.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('professionals.detail.profile.ivac.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditableField
            label={t('professionals.detail.profile.ivac.fieldLabel')}
            value={ivacNumber?.ivac_number || null}
            onSave={handleIvacNumberUpdate}
            isSaving={upsertIvacNumber.isPending || deleteIvacNumber.isPending}
            placeholder={t('professionals.detail.profile.ivac.placeholder')}
            hint={t('professionals.detail.profile.ivac.fieldHint')}
          />
        </CardContent>
      </Card>

      {/* Dates Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sage-600" />
            <CardTitle className="text-base">{t('professionals.detail.profile.dates.title')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.dates.createdAt')}
              </p>
              <p className="text-sm text-foreground">
                {formatDate(viewModel.createdAt)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.dates.updatedAt')}
              </p>
              <p className="text-sm text-foreground">
                {formatDate(viewModel.updatedAt)}
              </p>
            </div>

            {viewModel.questionnaireSubmittedAt && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground-muted">
                  {t('professionals.detail.profile.dates.questionnaireSubmitted')}
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(viewModel.questionnaireSubmittedAt)}
                  {viewModel.questionnaireSubmittedVia === 'invitation' && (
                    <span className="ml-2 text-xs text-foreground-muted">
                      {t('professionals.detail.profile.dates.viaInvitation')}
                    </span>
                  )}
                </p>
              </div>
            )}

            {professional.fiche_generated_at && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground-muted">
                  {t('professionals.detail.profile.dates.ficheGenerated')}
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(professional.fiche_generated_at)}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
