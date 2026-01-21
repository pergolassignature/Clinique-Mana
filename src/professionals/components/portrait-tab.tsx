import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase,
  Edit3,
  Check,
  X,
  Plus,
  Clock,
  CheckCircle,
  ChevronDown,
  Eye,
  Info,
  AlertTriangle,
  FileText,
  Code,
  Heart,
} from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations, Specialty, QuestionnaireResponses, QuestionnaireSubmission } from '../types'
import {
  useSpecialtiesByCategory,
  useUpdateProfessional,
  useAddSpecialty,
  useRemoveSpecialty,
  useProfessionalQuestionnaire,
  useApplyQuestionnaire,
  useReplaceMotifs,
} from '../hooks'
import { MotifPicker } from '@/shared/components/motif-picker'
import { MotifDisclaimerBanner } from '@/motifs'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ProfessionalPortraitTabProps {
  professional: ProfessionalWithRelations
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Provenance banner showing data source and apply success
function ProvenanceBanner({
  professional,
  submission,
  onViewSubmission,
  appliedAt,
}: {
  professional: ProfessionalWithRelations
  submission: QuestionnaireSubmission | null | undefined
  onViewSubmission: () => void
  appliedAt?: string | null
}) {
  const hasSubmission = submission?.submitted_at
  const wasApproved = submission?.status === 'approved'

  return (
    <div className="space-y-3">
      {/* Success banner after apply */}
      {appliedAt && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl bg-sage-50 border border-sage-200 p-4"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage-100 text-sage-600">
            <CheckCircle className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-medium text-sage-800">
              Données appliquées au profil le {formatDate(appliedAt)}
            </p>
            <p className="text-sage-600">
              Le profil affiche maintenant les informations du questionnaire approuvé.
            </p>
          </div>
        </motion.div>
      )}

      {/* Main provenance banner */}
      <div className="flex flex-col gap-2 rounded-xl bg-background-secondary/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage-100 text-sage-600">
            <Info className="h-4 w-4" />
          </div>
          <div className="text-sm">
            {hasSubmission ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    Soumis via invitation le {formatDate(submission.submitted_at)}
                  </span>
                  {wasApproved && (
                    <Badge variant="success" className="text-xs">
                      Approuvé
                    </Badge>
                  )}
                </div>
                {professional.updated_at && (
                  <p className="text-foreground-muted">
                    Dernière modification par l'équipe : {formatDate(professional.updated_at)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-foreground-muted">
                Profil créé le {formatDate(professional.created_at)}
                {professional.updated_at !== professional.created_at && (
                  <span> • Modifié le {formatDate(professional.updated_at)}</span>
                )}
              </p>
            )}
          </div>
        </div>
        {hasSubmission && (
          <Button variant="outline" size="sm" onClick={onViewSubmission}>
            <Eye className="h-4 w-4" />
            Voir la soumission originale
          </Button>
        )}
      </div>
    </div>
  )
}

// Original submission viewer modal
function OriginalSubmissionModal({
  open,
  onOpenChange,
  submission,
  specialtiesByCategory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  submission: QuestionnaireSubmission | null | undefined
  specialtiesByCategory: Record<string, Specialty[]>
}) {
  const [showJson, setShowJson] = useState(false)

  if (!submission?.responses) return null

  const responses = submission.responses
  const allSpecialties = Object.values(specialtiesByCategory).flat()
  const selectedSpecialties = (responses.specialties || [])
    .map((code) => allSpecialties.find((s) => s.code === code))
    .filter(Boolean) as Specialty[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Soumission originale
          </DialogTitle>
          <DialogDescription>
            Questionnaire soumis le {formatDate(submission.submitted_at)}
            {submission.status === 'approved' && (
              <span className="ml-2">
                • Approuvé le {formatDate(submission.reviewed_at)}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Personal Info */}
          {responses.full_name && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Identité
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Nom complet</span>
                  <span>{responses.full_name}</span>
                </div>
              </div>
            </section>
          )}

          {/* Professional Info */}
          {(responses.title || responses.license_number || responses.years_experience !== undefined) && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Informations professionnelles
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4 space-y-2 text-sm">
                {responses.title && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Titre</span>
                    <span>{responses.title}</span>
                  </div>
                )}
                {responses.license_number && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Numéro de permis</span>
                    <span>{responses.license_number}</span>
                  </div>
                )}
                {responses.years_experience !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Années d'expérience</span>
                    <span>{responses.years_experience}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Bio */}
          {responses.bio && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Biographie
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4">
                <p className="text-sm whitespace-pre-wrap">{responses.bio}</p>
              </div>
            </section>
          )}

          {/* Approach */}
          {responses.approach && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Approche
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4">
                <p className="text-sm whitespace-pre-wrap">{responses.approach}</p>
              </div>
            </section>
          )}

          {/* Education */}
          {responses.education && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Formation
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4">
                <p className="text-sm whitespace-pre-wrap">{responses.education}</p>
              </div>
            </section>
          )}

          {/* Languages */}
          {responses.languages && responses.languages.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Langues
              </h3>
              <div className="flex flex-wrap gap-2">
                {responses.languages.map((lang, i) => (
                  <Badge key={i} variant="secondary">{lang}</Badge>
                ))}
              </div>
            </section>
          )}

          {/* Specialties */}
          {selectedSpecialties.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Spécialités sélectionnées
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedSpecialties.map((specialty) => (
                  <Badge key={specialty.id} variant="secondary">
                    {specialty.name_fr}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Contact */}
          {(responses.public_email || responses.public_phone) && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Contact public
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4 space-y-2 text-sm">
                {responses.public_email && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Courriel</span>
                    <span>{responses.public_email}</span>
                  </div>
                )}
                {responses.public_phone && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Téléphone</span>
                    <span>{responses.public_phone}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Availability Notes */}
          {responses.availability_notes && (
            <section>
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                Notes de disponibilité
              </h3>
              <div className="rounded-xl bg-background-secondary/50 p-4">
                <p className="text-sm whitespace-pre-wrap">{responses.availability_notes}</p>
              </div>
            </section>
          )}

          {/* JSON Toggle */}
          <div className="pt-4 border-t border-border">
            <button
              onClick={() => setShowJson(!showJson)}
              className="flex items-center gap-2 text-xs text-foreground-muted hover:text-foreground transition-colors"
            >
              <Code className="h-3.5 w-3.5" />
              {showJson ? 'Masquer le JSON' : 'Voir JSON'}
            </button>

            <AnimatePresence>
              {showJson && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <pre className="mt-3 p-4 rounded-xl bg-background-secondary text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(responses, null, 2)}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const categoryLabels: Record<string, string> = {
  therapy_type: 'professionals.portrait.specialties.categories.therapy_type',
  population: 'professionals.portrait.specialties.categories.population',
  issue: 'professionals.portrait.specialties.categories.issue',
  modality: 'professionals.portrait.specialties.categories.modality',
}

// Editable text field with inline editing
function EditableField({
  label,
  value,
  placeholder,
  onSave,
  multiline = false,
  isEditable = true,
}: {
  label: string
  value: string | null | undefined
  placeholder: string
  onSave: (value: string) => Promise<void>
  multiline?: boolean
  isEditable?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(editValue)
      setIsEditing(false)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditValue(value || '')
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground-muted">{label}</p>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {multiline ? (
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="flex w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30 focus-visible:border-sage-300 resize-none"
            disabled={isSaving}
          />
        ) : (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
            disabled={isSaving}
          />
        )}
      </div>
    )
  }

  return (
    <div className="group">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground-muted">{label}</p>
        {isEditable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {value ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
          {value}
        </p>
      ) : (
        <p className="mt-1 text-sm text-foreground-muted italic">
          Non renseigné
        </p>
      )}
    </div>
  )
}

// Specialty selector component
function SpecialtyManager({
  professional,
  specialtiesByCategory,
  isEditable,
}: {
  professional: ProfessionalWithRelations
  specialtiesByCategory: Record<string, Specialty[]>
  isEditable: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const addSpecialty = useAddSpecialty()
  const removeSpecialty = useRemoveSpecialty()

  const currentSpecialtyIds = new Set(
    professional.specialties?.map((ps) => ps.specialty_id) || []
  )

  const professionalSpecialtiesByCategory = professional.specialties?.reduce(
    (acc, ps) => {
      if (ps.specialty) {
        const category = ps.specialty.category
        if (!acc[category]) acc[category] = []
        acc[category].push(ps.specialty)
      }
      return acc
    },
    {} as Record<string, Specialty[]>
  ) || {}

  const handleAddSpecialty = async (specialty: Specialty) => {
    try {
      await addSpecialty.mutateAsync({
        professional_id: professional.id,
        specialty_id: specialty.id,
      })
    } catch (err) {
      console.error('Failed to add specialty:', err)
    }
  }

  const handleRemoveSpecialty = async (specialtyId: string) => {
    try {
      await removeSpecialty.mutateAsync({
        professional_id: professional.id,
        specialty_id: specialtyId,
      })
    } catch (err) {
      console.error('Failed to remove specialty:', err)
    }
  }

  const hasSpecialties = professional.specialties && professional.specialties.length > 0

  return (
    <div className="space-y-4">
      {/* Current specialties grouped by category */}
      {hasSpecialties ? (
        <div className="space-y-4">
          {Object.entries(professionalSpecialtiesByCategory).map(([category, specialties]) => (
            <div key={category}>
              <p className="text-xs font-medium text-foreground-muted">
                {t(categoryLabels[category] as Parameters<typeof t>[0])}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {specialties.map((specialty) => (
                  <Badge
                    key={specialty.id}
                    variant="secondary"
                    className="group/badge pr-1"
                  >
                    {specialty.name_fr}
                    {isEditable && (
                      <button
                        onClick={() => handleRemoveSpecialty(specialty.id)}
                        className="ml-1 rounded-full p-0.5 opacity-0 group-hover/badge:opacity-100 hover:bg-background-tertiary transition-opacity"
                        disabled={removeSpecialty.isPending}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground-muted italic">
          {t('professionals.portrait.specialties.empty')}
        </p>
      )}

      {/* Add specialty button and picker */}
      {isEditable && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-4 w-4 rotate-180" />
                Fermer
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t('professionals.portrait.specialties.add')}
              </>
            )}
          </Button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-4 rounded-xl border border-border bg-background-secondary p-4">
                  {Object.entries(specialtiesByCategory).map(([category, specialties]) => {
                    const available = specialties.filter((s) => !currentSpecialtyIds.has(s.id))
                    if (available.length === 0) return null

                    return (
                      <div key={category}>
                        <p className="text-xs font-medium text-foreground-muted mb-2">
                          {t(categoryLabels[category] as Parameters<typeof t>[0])}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {available.map((specialty) => (
                            <button
                              key={specialty.id}
                              onClick={() => handleAddSpecialty(specialty)}
                              disabled={addSpecialty.isPending}
                              className="px-3 py-1.5 rounded-lg text-sm bg-background hover:bg-sage-50 border border-transparent hover:border-sage-200 transition-all"
                            >
                              <Plus className="inline h-3 w-3 mr-1" />
                              {specialty.name_fr}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// Motif manager component for editing consultation motifs
function MotifManager({
  professionalId,
  currentMotifKeys,
  isEditable,
}: {
  professionalId: string
  currentMotifKeys: string[]
  isEditable: boolean
}) {
  const { toast } = useToast()
  const replaceMotifs = useReplaceMotifs()

  const handleMotifsChange = async (newMotifKeys: string[]) => {
    try {
      await replaceMotifs.mutateAsync({
        professional_id: professionalId,
        motif_keys: newMotifKeys,
      })
      toast({
        title: 'Motifs mis à jour',
        description: `${newMotifKeys.length} motif(s) configuré(s).`,
      })
    } catch (err) {
      console.error('Failed to update motifs:', err)
      toast({
        title: 'Impossible de mettre à jour les motifs',
        description: 'Veuillez réessayer plus tard.',
        variant: 'error',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-foreground-muted" />
          <span className="text-sm font-medium">
            {t('professionals.portrait.motifs.title')}
          </span>
        </div>
        {currentMotifKeys.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {currentMotifKeys.length}
          </Badge>
        )}
      </div>

      <MotifDisclaimerBanner />

      <MotifPicker
        selected={currentMotifKeys}
        onChange={handleMotifsChange}
        readOnly={!isEditable}
        showGuidance={false}
      />
    </div>
  )
}

// Questionnaire submission review component with confirmation dialog
function QuestionnaireReview({
  professionalId,
  responses,
  submissionId,
  specialtiesByCategory,
  onApplied,
}: {
  professionalId: string
  responses: QuestionnaireResponses
  submissionId: string
  specialtiesByCategory: Record<string, Specialty[]>
  onApplied: (appliedAt: string) => void
}) {
  const { toast } = useToast()
  const applyQuestionnaire = useApplyQuestionnaire()
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Find specialty names from codes
  const allSpecialties = Object.values(specialtiesByCategory).flat()
  const selectedSpecialties = (responses.specialties || [])
    .map((code) => allSpecialties.find((s) => s.code === code))
    .filter(Boolean) as Specialty[]

  // Get motif keys from responses
  const selectedMotifKeys = responses.motifs || []

  // Build what will be replaced (for confirmation dialog)
  const fieldsToReplace: string[] = []
  if (responses.bio !== undefined) fieldsToReplace.push('Biographie')
  if (responses.approach !== undefined) fieldsToReplace.push('Approche thérapeutique')
  if (responses.public_email !== undefined) fieldsToReplace.push('Courriel public')
  if (responses.public_phone !== undefined) fieldsToReplace.push('Téléphone public')
  if (responses.license_number !== undefined) fieldsToReplace.push('Numéro de permis')
  if (responses.years_experience !== undefined) fieldsToReplace.push("Années d'expérience")
  if (selectedSpecialties.length > 0) fieldsToReplace.push(`${selectedSpecialties.length} spécialité(s)`)
  if (selectedMotifKeys.length > 0) fieldsToReplace.push(`${selectedMotifKeys.length} motif(s)`)

  const handleConfirmApply = async () => {
    try {
      // Build the updates from questionnaire responses
      const professionalUpdates: {
        portrait_bio?: string | null
        portrait_approach?: string | null
        public_email?: string | null
        public_phone?: string | null
        license_number?: string | null
        years_experience?: number | null
      } = {}

      if (responses.bio !== undefined) {
        professionalUpdates.portrait_bio = responses.bio || null
      }
      if (responses.approach !== undefined) {
        professionalUpdates.portrait_approach = responses.approach || null
      }
      if (responses.public_email !== undefined) {
        professionalUpdates.public_email = responses.public_email || null
      }
      if (responses.public_phone !== undefined) {
        professionalUpdates.public_phone = responses.public_phone || null
      }
      if (responses.license_number !== undefined) {
        professionalUpdates.license_number = responses.license_number || null
      }
      if (responses.years_experience !== undefined) {
        professionalUpdates.years_experience = responses.years_experience || null
      }

      const result = await applyQuestionnaire.mutateAsync({
        professional_id: professionalId,
        submission_id: submissionId,
        professional_updates: professionalUpdates,
        specialty_codes: responses.specialties,
        motif_keys: responses.motifs,
      })

      setShowConfirmDialog(false)
      onApplied(result.applied_at)

      const parts: string[] = []
      if (result.fields_updated.length > 0) {
        parts.push(`${result.fields_updated.length} champ(s) mis à jour`)
      }
      if (result.specialties_replaced > 0) {
        parts.push(`${result.specialties_replaced} spécialité(s) configurées`)
      }
      if (result.motifs_replaced > 0) {
        parts.push(`${result.motifs_replaced} motif(s) configurés`)
      }

      toast({
        title: 'Données appliquées au profil',
        description: parts.join(', ') + '.',
      })
    } catch (err) {
      console.error('Failed to apply questionnaire:', err)
      toast({
        title: 'Impossible d\'appliquer le questionnaire pour le moment',
        description: 'Veuillez réessayer plus tard ou contacter le support.',
        variant: 'error',
      })
    }
  }

  // Count how many fields will be updated
  const updateCount = [
    responses.bio,
    responses.approach,
    responses.public_email,
    responses.public_phone,
    responses.license_number,
    responses.years_experience,
  ].filter((v) => v !== undefined).length

  return (
    <>
      <Card className="border-honey-200 bg-honey-50/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-honey-600" />
            <CardTitle className="text-base">
              Questionnaire en attente de révision
            </CardTitle>
          </div>
          <CardDescription>
            Le professionnel a soumis son questionnaire. Révisez les informations ci-dessous et approuvez pour les transférer au profil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Personal Info - display only, not mapped to professionals table */}
          {responses.full_name && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Informations personnelles</h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Nom complet</span>
                  <span>{responses.full_name}</span>
                </div>
              </div>
            </div>
          )}

          {/* Professional Info */}
          {(responses.title || responses.license_number || responses.years_experience !== undefined) && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Informations professionnelles</h4>
              <div className="grid gap-2 text-sm">
                {responses.title && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Titre</span>
                    <span>{responses.title}</span>
                  </div>
                )}
                {responses.license_number && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Numéro de permis</span>
                    <span>{responses.license_number}</span>
                  </div>
                )}
                {responses.years_experience !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Années d'expérience</span>
                    <span>{responses.years_experience}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bio & Approach */}
          {(responses.bio || responses.approach) && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Portrait</h4>
              <div className="space-y-4">
                {responses.bio && (
                  <div>
                    <p className="text-xs font-medium text-foreground-muted mb-1">Biographie</p>
                    <p className="text-sm whitespace-pre-wrap">{responses.bio}</p>
                  </div>
                )}
                {responses.approach && (
                  <div>
                    <p className="text-xs font-medium text-foreground-muted mb-1">Approche</p>
                    <p className="text-sm whitespace-pre-wrap">{responses.approach}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Contact */}
          {(responses.public_email || responses.public_phone) && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Contact public</h4>
              <div className="grid gap-2 text-sm">
                {responses.public_email && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Courriel</span>
                    <span>{responses.public_email}</span>
                  </div>
                )}
                {responses.public_phone && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Téléphone</span>
                    <span>{responses.public_phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Specialties */}
          {selectedSpecialties.length > 0 && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Spécialités sélectionnées</h4>
              <div className="flex flex-wrap gap-2">
                {selectedSpecialties.map((specialty) => (
                  <Badge key={specialty.id} variant="secondary">
                    {specialty.name_fr}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Motifs */}
          {selectedMotifKeys.length > 0 && (
            <div className="rounded-xl bg-background p-4">
              <h4 className="text-sm font-medium mb-3">Motifs de consultation</h4>
              <div className="flex flex-wrap gap-2">
                {selectedMotifKeys.map((key) => (
                  <Badge key={key} variant="secondary">
                    {key}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Summary of what will be applied */}
          <div className="rounded-xl bg-sage-50 border border-sage-200 p-4">
            <h4 className="text-sm font-medium text-sage-800 mb-2">
              Ce qui sera appliqué au profil
            </h4>
            <ul className="text-sm text-sage-700 space-y-1">
              {updateCount > 0 && (
                <li>• {updateCount} champ(s) du profil</li>
              )}
              {selectedSpecialties.length > 0 && (
                <li>• {selectedSpecialties.length} spécialité(s) (remplacera les existantes)</li>
              )}
              {selectedMotifKeys.length > 0 && (
                <li>• {selectedMotifKeys.length} motif(s) (remplacera les existants)</li>
              )}
            </ul>
            <p className="mt-3 text-xs text-sage-600">
              Cette action remplace les informations actuelles du profil par celles du questionnaire.
              Vous pourrez ensuite ajuster le portrait au besoin.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              onClick={() => setShowConfirmDialog(true)}
              disabled={applyQuestionnaire.isPending || (updateCount === 0 && selectedSpecialties.length === 0 && selectedMotifKeys.length === 0)}
            >
              {applyQuestionnaire.isPending ? (
                <Clock className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Appliquer au profil
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-honey-600" />
              Appliquer le questionnaire au profil ?
            </DialogTitle>
            <DialogDescription className="pt-2">
              Les informations suivantes seront remplacées sur le profil :
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <ul className="text-sm space-y-1.5">
              {fieldsToReplace.map((field, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-sage-500" />
                  {field}
                </li>
              ))}
            </ul>

            <div className="rounded-lg bg-honey-50 border border-honey-200 p-3 text-sm text-honey-800">
              Les informations actuelles seront remplacées. Cette action est enregistrée dans l'historique.
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              disabled={applyQuestionnaire.isPending}
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmApply}
              disabled={applyQuestionnaire.isPending}
            >
              {applyQuestionnaire.isPending ? (
                <Clock className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ProfessionalPortraitTab({ professional }: ProfessionalPortraitTabProps) {
  const { data: specialtiesByCategory, isLoading: loadingSpecialties } = useSpecialtiesByCategory()
  const { data: submission } = useProfessionalQuestionnaire(professional.id)
  const updateProfessional = useUpdateProfessional()
  const { toast } = useToast()

  // Track when questionnaire was just applied (for success banner)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  // Track if original submission sheet is open
  const [showSubmissionSheet, setShowSubmissionSheet] = useState(false)

  const hasPortrait = professional.portrait_bio || professional.portrait_approach
  const hasSpecialties = professional.specialties && professional.specialties.length > 0
  const hasContact = professional.public_email || professional.public_phone

  // Get current motif keys from professional.motifs
  const currentMotifKeys = (professional.motifs || [])
    .map((pm) => pm.motif?.key)
    .filter((key): key is string => !!key)

  // Check if there's a pending submission to review
  const hasPendingSubmission = submission && submission.status === 'submitted'

  // Staff can always edit portrait fields regardless of questionnaire state
  const isEditable = true

  const handleUpdateField = (field: string) => async (value: string) => {
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: { [field]: value || null },
    })
  }

  const handleViewSubmission = () => {
    // Check if we have actual responses to show
    if (submission?.responses && Object.keys(submission.responses).length > 0) {
      setShowSubmissionSheet(true)
    } else {
      toast({
        title: 'Données non disponibles',
        description: 'Les données de la soumission originale ne sont pas disponibles.',
      })
    }
  }

  const handleApplied = (timestamp: string) => {
    setAppliedAt(timestamp)
  }

  // Empty state - only show if nothing to display AND no pending submission
  if (!hasPortrait && !hasSpecialties && !hasContact && !hasPendingSubmission) {
    return (
      <EmptyState
        icon={<Briefcase className="h-8 w-8" />}
        title={t('professionals.portrait.empty.title')}
        description={t('professionals.portrait.empty.description')}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Provenance banner */}
      {(hasPortrait || hasSpecialties || hasContact || appliedAt) && (
        <ProvenanceBanner
          professional={professional}
          submission={submission}
          onViewSubmission={handleViewSubmission}
          appliedAt={appliedAt}
        />
      )}

      {/* Pending questionnaire review */}
      {hasPendingSubmission && specialtiesByCategory && (
        <QuestionnaireReview
          professionalId={professional.id}
          responses={submission.responses}
          submissionId={submission.id}
          specialtiesByCategory={specialtiesByCategory}
          onApplied={handleApplied}
        />
      )}

      {/* Original submission modal */}
      <OriginalSubmissionModal
        open={showSubmissionSheet}
        onOpenChange={setShowSubmissionSheet}
        submission={submission}
        specialtiesByCategory={specialtiesByCategory || {}}
      />

      {/* Portrait cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bio */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('professionals.portrait.bio.label')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EditableField
              label=""
              value={professional.portrait_bio}
              placeholder={t('professionals.portrait.bio.placeholder')}
              onSave={handleUpdateField('portrait_bio')}
              multiline
              isEditable={isEditable}
            />
          </CardContent>
        </Card>

        {/* Approach */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('professionals.portrait.approach.label')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EditableField
              label=""
              value={professional.portrait_approach}
              placeholder={t('professionals.portrait.approach.placeholder')}
              onSave={handleUpdateField('portrait_approach')}
              multiline
              isEditable={isEditable}
            />
          </CardContent>
        </Card>

        {/* Public Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('professionals.portrait.contact.title')}
            </CardTitle>
            <CardDescription>
              Coordonnées affichées sur la fiche publique
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EditableField
              label={t('professionals.portrait.contact.email')}
              value={professional.public_email}
              placeholder={t('professionals.portrait.contact.emailPlaceholder')}
              onSave={handleUpdateField('public_email')}
              isEditable={isEditable}
            />
            <EditableField
              label={t('professionals.portrait.contact.phone')}
              value={professional.public_phone}
              placeholder={t('professionals.portrait.contact.phonePlaceholder')}
              onSave={handleUpdateField('public_phone')}
              isEditable={isEditable}
            />
          </CardContent>
        </Card>

        {/* Specialties */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('professionals.portrait.specialties.title')}
            </CardTitle>
            <CardDescription>
              {professional.specialties?.length || 0} spécialité(s) sélectionnée(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSpecialties ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-24" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <SpecialtyManager
                professional={professional}
                specialtiesByCategory={specialtiesByCategory || {}}
                isEditable={isEditable}
              />
            )}
          </CardContent>
        </Card>

        {/* Motifs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('professionals.portrait.motifs.title')}
            </CardTitle>
            <CardDescription>
              {currentMotifKeys.length} motif(s) de consultation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MotifManager
              professionalId={professional.id}
              currentMotifKeys={currentMotifKeys}
              isEditable={isEditable}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
