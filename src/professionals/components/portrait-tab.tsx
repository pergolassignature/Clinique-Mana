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
} from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations, Specialty, QuestionnaireResponses } from '../types'
import {
  useSpecialtiesByCategory,
  useUpdateProfessional,
  useAddSpecialty,
  useRemoveSpecialty,
  useProfessionalQuestionnaire,
  useReviewQuestionnaire,
} from '../hooks'
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

interface ProfessionalPortraitTabProps {
  professional: ProfessionalWithRelations
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

// Questionnaire submission review component
function QuestionnaireReview({
  responses,
  submissionId,
  specialtiesByCategory,
}: {
  responses: QuestionnaireResponses
  submissionId: string
  specialtiesByCategory: Record<string, Specialty[]>
}) {
  const [reviewNotes, setReviewNotes] = useState('')
  const reviewQuestionnaire = useReviewQuestionnaire()

  const handleApprove = async () => {
    try {
      await reviewQuestionnaire.mutateAsync({
        id: submissionId,
        status: 'approved',
        review_notes: reviewNotes || undefined,
      })
    } catch (err) {
      console.error('Failed to approve:', err)
    }
  }

  // Find specialty names from codes
  const allSpecialties = Object.values(specialtiesByCategory).flat()
  const selectedSpecialties = (responses.specialties || [])
    .map((code) => allSpecialties.find((s) => s.code === code))
    .filter(Boolean) as Specialty[]

  return (
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
        {/* Personal Info */}
        {(responses.full_name || responses.preferred_name || responses.pronouns) && (
          <div className="rounded-xl bg-background p-4">
            <h4 className="text-sm font-medium mb-3">Informations personnelles</h4>
            <div className="grid gap-2 text-sm">
              {responses.full_name && (
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Nom complet</span>
                  <span>{responses.full_name}</span>
                </div>
              )}
              {responses.preferred_name && (
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Nom préféré</span>
                  <span>{responses.preferred_name}</span>
                </div>
              )}
              {responses.pronouns && (
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Pronoms</span>
                  <span>{responses.pronouns}</span>
                </div>
              )}
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

        {/* Review notes */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            Notes de révision (optionnel)
          </label>
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Ajoutez des notes si nécessaire..."
            rows={3}
            className="flex w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30 focus-visible:border-sage-300 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            onClick={handleApprove}
            disabled={reviewQuestionnaire.isPending}
          >
            <CheckCircle className="h-4 w-4" />
            {t('professionals.detail.questionnaire.actions.approve')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProfessionalPortraitTab({ professional }: ProfessionalPortraitTabProps) {
  const { data: specialtiesByCategory, isLoading: loadingSpecialties } = useSpecialtiesByCategory()
  const { data: submission } = useProfessionalQuestionnaire(professional.id)
  const updateProfessional = useUpdateProfessional()

  const hasPortrait = professional.portrait_bio || professional.portrait_approach
  const hasSpecialties = professional.specialties && professional.specialties.length > 0
  const hasContact = professional.public_email || professional.public_phone

  // Check if there's a pending submission to review
  const hasPendingSubmission = submission && submission.status === 'submitted'

  // Can edit only if approved or no pending submission
  const isEditable = professional.status === 'active' && !hasPendingSubmission

  const handleUpdateField = (field: string) => async (value: string) => {
    await updateProfessional.mutateAsync({
      id: professional.id,
      input: { [field]: value || null },
    })
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
      {/* Pending questionnaire review */}
      {hasPendingSubmission && specialtiesByCategory && (
        <QuestionnaireReview
          responses={submission.responses}
          submissionId={submission.id}
          specialtiesByCategory={specialtiesByCategory}
        />
      )}

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
      </div>
    </div>
  )
}
