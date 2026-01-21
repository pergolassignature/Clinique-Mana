import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  User,
  Mail,
  Award,
  Calendar,
  Briefcase,
  FileText,
  CheckCircle,
  AlertCircle,
  Clock,
  Edit3,
  X,
  Check,
  Loader2,
  ArrowRight,
  GraduationCap,
  Building2,
} from 'lucide-react'
import { formatClinicDateFull } from '@/shared/lib/timezone'
import type { ProfessionalWithRelations, ProfessionalDocument, ProfessionalDetailTab } from '../types'
import { useUpdateProfessional } from '../hooks'
import {
  useProfessionalIvacNumber,
  useUpsertProfessionalIvacNumber,
  useDeleteProfessionalIvacNumber,
} from '@/external-payers'
import { ProfessionEditor } from './profession-editor'
import { mapProfessionalToViewModel, SPECIALTY_CATEGORY_LABELS } from '../mappers'
import { getDocumentDownloadUrl } from '../api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useToast } from '@/shared/hooks/use-toast'

interface ProfessionalProfileTabProps {
  professional: ProfessionalWithRelations
  onNavigateToTab?: (tab: ProfessionalDetailTab) => void
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
        title: 'Mise à jour effectuée',
        description: `${label} a été modifié.`,
      })
    } catch (err) {
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour ce champ.',
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
          aria-label={`Modifier ${label}`}
        >
          <Edit3 className="h-3.5 w-3.5 text-foreground-muted hover:text-foreground" />
        </button>
      </div>
    </div>
  )
}

function StatusIndicator({
  label,
  status,
  description,
}: {
  label: string
  status: 'complete' | 'pending' | 'warning'
  description?: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-background-secondary/50 p-3">
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          status === 'complete'
            ? 'bg-sage-100 text-sage-600'
            : status === 'warning'
              ? 'bg-wine-100 text-wine-600'
              : 'bg-honey-100 text-honey-600'
        }`}
      >
        {status === 'complete' ? (
          <CheckCircle className="h-3.5 w-3.5" />
        ) : status === 'warning' ? (
          <AlertCircle className="h-3.5 w-3.5" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
        )}
      </div>
    </div>
  )
}

// Hook to get profile photo URL
function useProfilePhotoUrl(documents: ProfessionalDocument[] | undefined) {
  const photoDoc = documents?.find(
    (doc) => doc.document_type === 'photo' && doc.file_path
  )

  return useQuery({
    queryKey: ['document-url', photoDoc?.id],
    queryFn: () => getDocumentDownloadUrl(photoDoc!.file_path),
    enabled: !!photoDoc?.file_path,
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
    gcTime: 1000 * 60 * 60, // Keep in cache for 1 hour
  })
}

// Profile Avatar component with photo support
function ProfileAvatar({
  photoUrl,
  initials,
  isLoading,
  size = 'md',
}: {
  photoUrl?: string
  initials: string
  isLoading?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses = {
    sm: 'h-10 w-10',
    md: 'h-14 w-14',
    lg: 'h-20 w-20',
  }
  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  }

  if (isLoading) {
    return (
      <div className={`flex ${sizeClasses[size]} shrink-0 items-center justify-center rounded-full bg-sage-100`}>
        <Loader2 className="h-5 w-5 animate-spin text-sage-600" />
      </div>
    )
  }

  if (photoUrl) {
    return (
      <div className={`relative ${sizeClasses[size]} shrink-0 overflow-hidden rounded-full`}>
        <img
          src={photoUrl}
          alt="Photo de profil"
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className={`flex ${sizeClasses[size]} shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-600`}>
      <span className={`${textSizeClasses[size]} font-semibold`}>{initials}</span>
    </div>
  )
}

export function ProfessionalProfileTab({ professional, onNavigateToTab }: ProfessionalProfileTabProps) {
  const updateProfessional = useUpdateProfessional()
  const viewModel = mapProfessionalToViewModel(professional)

  // Get profile photo URL
  const { data: photoUrl, isLoading: isLoadingPhoto } = useProfilePhotoUrl(professional.documents)

  // IVAC number management
  const { data: ivacNumber } = useProfessionalIvacNumber(professional.id)
  const upsertIvacNumber = useUpsertProfessionalIvacNumber()
  const deleteIvacNumber = useDeleteProfessionalIvacNumber()

  const handleFieldUpdate = async (field: string, value: string) => {
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: { [field]: value || null },
    })
  }

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

  // Determine indicator statuses
  const hasPortrait = Boolean(viewModel.bio || viewModel.approach)
  const portraitStatus = hasPortrait ? 'complete' : 'pending'

  const missingDocs = viewModel.requiredDocuments.filter(
    d => d.status === 'missing' || d.status === 'expired'
  ).length
  const docsStatus = missingDocs === 0 ? 'complete' : missingDocs > 2 ? 'warning' : 'pending'

  const hasFiche = Boolean(professional.fiche_generated_at)
  const ficheStatus = hasFiche ? 'complete' : 'pending'

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left column - Identity & Contact */}
      <div className="space-y-6 lg:col-span-2">
        {/* Identity Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">Identité</CardTitle>
            </div>
            <CardDescription>
              Informations de base du professionnel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Profile photo + name row */}
              <div className="space-y-1 sm:col-span-2">
                <div className="flex items-center gap-4">
                  <ProfileAvatar
                    photoUrl={photoUrl}
                    initials={viewModel.initials}
                    isLoading={isLoadingPhoto}
                  />
                  <div>
                    <p className="text-base font-medium text-foreground">
                      {viewModel.displayName}
                    </p>
                    <p className="text-sm text-foreground-muted">{viewModel.email}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground-muted">Statut</p>
                <div>
                  <Badge
                    variant={
                      viewModel.status === 'active'
                        ? 'success'
                        : viewModel.status === 'inactive'
                          ? 'error'
                          : viewModel.status === 'invited'
                            ? 'warning'
                            : 'secondary'
                    }
                  >
                    {viewModel.status === 'active'
                      ? 'Actif'
                      : viewModel.status === 'inactive'
                        ? 'Inactif'
                        : viewModel.status === 'invited'
                          ? 'Invité'
                          : 'En attente'}
                  </Badge>
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
              <CardTitle className="text-base">Titres professionnels</CardTitle>
            </div>
            <CardDescription>
              Chaque titre nécessite son propre numéro de permis (max 2)
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
              <CardTitle className="text-base">Accréditation</CardTitle>
            </div>
            <CardDescription>
              Expérience professionnelle
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditableField
              label="Années d'expérience"
              value={viewModel.yearsExperience?.toString() || null}
              onSave={handleYearsExperienceUpdate}
              isSaving={updateProfessional.isPending}
              placeholder="Ex: 5"
              type="number"
            />
          </CardContent>
        </Card>

        {/* Contact Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">Contact public</CardTitle>
            </div>
            <CardDescription>
              Coordonnées affichées sur le profil public
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <EditableField
                label="Courriel public"
                value={viewModel.publicEmail}
                onSave={(value) => handleFieldUpdate('public_email', value)}
                isSaving={updateProfessional.isPending}
                placeholder="courriel@exemple.com"
                type="email"
              />

              <EditableField
                label="Téléphone public"
                value={viewModel.publicPhone}
                onSave={(value) => handleFieldUpdate('public_phone', value)}
                isSaving={updateProfessional.isPending}
                placeholder="514-555-0000"
                type="tel"
              />
            </div>
          </CardContent>
        </Card>

        {/* IVAC Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">IVAC</CardTitle>
            </div>
            <CardDescription>
              Numéro d'identification pour les dossiers IVAC
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditableField
              label="Numéro IVAC du professionnel"
              value={ivacNumber?.ivac_number || null}
              onSave={handleIvacNumberUpdate}
              isSaving={upsertIvacNumber.isPending || deleteIvacNumber.isPending}
              placeholder="Ex: IVAC-PRO-123456"
              hint="Ce numéro sera affiché dans les dossiers clients IVAC"
            />
          </CardContent>
        </Card>

        {/* Dates Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">Dates importantes</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground-muted">
                  Création du profil
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(viewModel.createdAt)}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground-muted">
                  Dernière modification
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(viewModel.updatedAt)}
                </p>
              </div>

              {viewModel.questionnaireSubmittedAt && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground-muted">
                    Questionnaire soumis
                  </p>
                  <p className="text-sm text-foreground">
                    {formatDate(viewModel.questionnaireSubmittedAt)}
                    {viewModel.questionnaireSubmittedVia === 'invitation' && (
                      <span className="ml-2 text-xs text-foreground-muted">
                        via invitation
                      </span>
                    )}
                  </p>
                </div>
              )}

              {professional.fiche_generated_at && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground-muted">
                    Dernière fiche générée
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

      {/* Right column - Indicators */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">Indicateurs</CardTitle>
            </div>
            <CardDescription>
              Vue d'ensemble de la complétude du profil
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusIndicator
              label="Portrait"
              status={portraitStatus}
              description={
                hasPortrait
                  ? 'Biographie et approche complétées'
                  : 'Biographie ou approche manquante'
              }
            />

            <StatusIndicator
              label="Documents"
              status={docsStatus}
              description={
                docsStatus === 'complete'
                  ? 'Tous les documents requis sont vérifiés'
                  : `${missingDocs} document(s) manquant(s) ou expiré(s)`
              }
            />

            <StatusIndicator
              label="Fiche"
              status={ficheStatus}
              description={
                hasFiche
                  ? `Version ${professional.fiche_version}`
                  : 'Fiche non générée'
              }
            />
          </CardContent>
        </Card>

        {/* Specialties summary */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-sage-600" />
                <CardTitle className="text-base">Spécialités</CardTitle>
              </div>
              {onNavigateToTab && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigateToTab('portrait')}
                >
                  <Edit3 className="h-4 w-4" />
                  Modifier
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {Object.keys(viewModel.specialtiesByCategory).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(viewModel.specialtiesByCategory).map(
                  ([category, specialties]) => (
                    <div key={category}>
                      <p className="text-xs font-medium text-foreground-muted">
                        {SPECIALTY_CATEGORY_LABELS[category] || category}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {specialties.slice(0, 3).map((specialty) => (
                          <Badge key={specialty.id} variant="secondary">
                            {specialty.name_fr}
                          </Badge>
                        ))}
                        {specialties.length > 3 && (
                          <Badge variant="outline">
                            +{specialties.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-foreground-muted">
                  Aucune spécialité sélectionnée
                </p>
                {onNavigateToTab && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => onNavigateToTab('portrait')}
                    className="mt-2"
                  >
                    Ajouter des spécialités
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
