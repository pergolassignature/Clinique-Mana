import { useState, useEffect, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
  ChevronLeft,
  User,
  Briefcase,
  FileText,
  Loader2,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  fetchInviteByToken,
  markInviteOpened,
  submitQuestionnaire,
  saveDraftQuestionnaire,
  fetchSpecialtiesByCategory,
} from '@/professionals/api'
import type { OnboardingInvite, Specialty, QuestionnaireResponses } from '@/professionals'

type InviteState = 'loading' | 'valid' | 'expired' | 'invalid' | 'completed' | 'error'
type FormStep = 'personal' | 'professional' | 'portrait' | 'specialties' | 'review'

const STEPS: FormStep[] = ['personal', 'professional', 'portrait', 'specialties', 'review']

function StepIndicator({
  currentStep,
  steps,
}: {
  currentStep: FormStep
  steps: FormStep[]
}) {
  const currentIndex = steps.indexOf(currentStep)

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const isActive = index === currentIndex
        const isCompleted = index < currentIndex

        return (
          <div key={step} className="flex items-center">
            <div
              className={`
                flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all duration-300
                ${isActive ? 'bg-sage-500 text-white scale-110' : ''}
                ${isCompleted ? 'bg-sage-100 text-sage-600' : ''}
                ${!isActive && !isCompleted ? 'bg-background-tertiary text-foreground-muted' : ''}
              `}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`
                  mx-1.5 h-0.5 w-6 transition-colors duration-300
                  ${index < currentIndex ? 'bg-sage-300' : 'bg-border'}
                `}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SpecialtySelector({
  selectedSpecialties,
  onToggle,
  specialtiesByCategory,
}: {
  selectedSpecialties: string[]
  onToggle: (code: string) => void
  specialtiesByCategory: Record<string, Specialty[]>
}) {
  const categoryLabels: Record<string, string> = {
    therapy_type: t('professionals.portrait.specialties.categories.therapy_type'),
    population: t('professionals.portrait.specialties.categories.population'),
    issue: t('professionals.portrait.specialties.categories.issue'),
    modality: t('professionals.portrait.specialties.categories.modality'),
  }

  return (
    <div className="space-y-6">
      {Object.entries(specialtiesByCategory).map(([category, specialties]) => (
        <div key={category}>
          <h4 className="text-sm font-medium text-foreground-secondary mb-3">
            {categoryLabels[category] || category}
          </h4>
          <div className="flex flex-wrap gap-2">
            {specialties.map((specialty) => {
              const isSelected = selectedSpecialties.includes(specialty.code)
              return (
                <button
                  key={specialty.id}
                  type="button"
                  onClick={() => onToggle(specialty.code)}
                  className={`
                    px-3 py-1.5 rounded-lg text-sm transition-all duration-200
                    ${isSelected
                      ? 'bg-sage-100 text-sage-700 border-2 border-sage-300'
                      : 'bg-background-tertiary text-foreground-secondary border-2 border-transparent hover:border-border'
                    }
                  `}
                >
                  {specialty.name_fr}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function InvitePage() {
  const { token } = useParams({ strict: false }) as { token: string }

  const [state, setState] = useState<InviteState>('loading')
  const [invite, setInvite] = useState<OnboardingInvite | null>(null)
  const [specialtiesByCategory, setSpecialtiesByCategory] = useState<Record<string, Specialty[]>>({})
  const [currentStep, setCurrentStep] = useState<FormStep>('personal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)

  // Form state
  const [formData, setFormData] = useState<QuestionnaireResponses>({
    full_name: '',
    preferred_name: '',
    pronouns: '',
    title: '',
    license_number: '',
    years_experience: undefined,
    bio: '',
    approach: '',
    public_email: '',
    public_phone: '',
    specialties: [],
  })

  // Load invite and specialties
  useEffect(() => {
    async function loadData() {
      if (!token) {
        setState('invalid')
        return
      }

      try {
        const [inviteData, specialties] = await Promise.all([
          fetchInviteByToken(token),
          fetchSpecialtiesByCategory(),
        ])

        if (!inviteData) {
          setState('invalid')
          return
        }

        // Check if expired
        if (new Date(inviteData.expires_at) < new Date()) {
          setState('expired')
          return
        }

        // Check if revoked
        if (inviteData.status === 'revoked') {
          setState('invalid')
          return
        }

        // Check if already completed
        if (inviteData.status === 'completed') {
          setState('completed')
          return
        }

        setInvite(inviteData)
        setSpecialtiesByCategory(specialties)

        // Mark as opened if pending
        if (inviteData.status === 'pending') {
          await markInviteOpened(token)
        }

        setState('valid')
      } catch (err) {
        console.error('Error loading invite:', err)
        setState('error')
      }
    }

    loadData()
  }, [token])

  const updateFormData = (updates: Partial<QuestionnaireResponses>) => {
    setFormData((prev) => ({ ...prev, ...updates }))
  }

  const toggleSpecialty = (code: string) => {
    setFormData((prev) => {
      const current = prev.specialties || []
      const updated = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code]
      return { ...prev, specialties: updated }
    })
  }

  const currentStepIndex = STEPS.indexOf(currentStep)
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === STEPS.length - 1

  const goNext = () => {
    const nextStep = STEPS[currentStepIndex + 1]
    if (!isLastStep && nextStep) {
      setCurrentStep(nextStep)
    }
  }

  const goBack = () => {
    const prevStep = STEPS[currentStepIndex - 1]
    if (!isFirstStep && prevStep) {
      setCurrentStep(prevStep)
    }
  }

  const handleSaveDraft = async () => {
    if (!invite) return

    setIsSavingDraft(true)
    try {
      await saveDraftQuestionnaire({
        professional_id: invite.professional_id,
        invite_id: invite.id,
        responses: formData,
      })
    } catch (err) {
      console.error('Failed to save draft:', err)
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleSubmit = async () => {
    if (!invite) return

    setIsSubmitting(true)
    try {
      await submitQuestionnaire({
        professional_id: invite.professional_id,
        invite_id: invite.id,
        responses: formData,
      })
      setState('completed')
    } catch (err) {
      console.error('Failed to submit questionnaire:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Validation per step
  const stepValidation = useMemo(() => {
    return {
      personal: Boolean(formData.full_name?.trim()),
      professional: Boolean(formData.title?.trim()),
      portrait: Boolean(formData.bio?.trim()),
      specialties: true, // Optional
      review: true,
    }
  }, [formData])

  const canProceed = stepValidation[currentStep]

  // Render states
  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sage-50 to-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
          <p className="text-sm text-foreground-muted">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (state === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-honey-50 to-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-honey-100">
              <Clock className="h-8 w-8 text-honey-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('professionals.invite.public.expired.title')}
          </h1>
          <p className="mt-3 text-foreground-secondary">
            {t('professionals.invite.public.expired.description')}
          </p>
        </div>
      </div>
    )
  }

  if (state === 'invalid' || state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-wine-50 to-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-wine-100">
              <AlertCircle className="h-8 w-8 text-wine-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('professionals.invite.public.invalid.title')}
          </h1>
          <p className="mt-3 text-foreground-secondary">
            {t('professionals.invite.public.invalid.description')}
          </p>
        </div>
      </div>
    )
  }

  if (state === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sage-50 to-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', duration: 0.5 }}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-100"
            >
              <CheckCircle2 className="h-10 w-10 text-sage-600" />
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-2xl font-semibold text-foreground">
              {t('professionals.invite.public.completed.title')}
            </h1>
            <p className="mt-3 text-foreground-secondary">
              {t('professionals.invite.public.completed.description')}
            </p>
          </motion.div>
        </div>
      </div>
    )
  }

  // Valid state - show the form
  return (
    <div className="min-h-screen bg-gradient-to-b from-sage-50/50 to-background py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('professionals.invite.public.title')}
          </h1>
          <p className="mt-2 text-foreground-secondary">
            {t('professionals.invite.public.subtitle')}
          </p>
        </div>

        {/* Progress */}
        <StepIndicator currentStep={currentStep} steps={STEPS} />

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-background p-6 shadow-soft">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Step 1: Personal Info */}
              {currentStep === 'personal' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <User className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">
                        {t('professionals.invite.public.form.personalInfo')}
                      </h2>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.fullName')} *
                      </label>
                      <Input
                        value={formData.full_name || ''}
                        onChange={(e) => updateFormData({ full_name: e.target.value })}
                        placeholder={t('professionals.invite.public.form.fullNamePlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.preferredName')}
                      </label>
                      <Input
                        value={formData.preferred_name || ''}
                        onChange={(e) => updateFormData({ preferred_name: e.target.value })}
                        placeholder={t('professionals.invite.public.form.preferredNamePlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.pronouns')}
                      </label>
                      <Input
                        value={formData.pronouns || ''}
                        onChange={(e) => updateFormData({ pronouns: e.target.value })}
                        placeholder={t('professionals.invite.public.form.pronounsPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Professional Info */}
              {currentStep === 'professional' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <Briefcase className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">
                        {t('professionals.invite.public.form.professionalInfo')}
                      </h2>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.title')} *
                      </label>
                      <Input
                        value={formData.title || ''}
                        onChange={(e) => updateFormData({ title: e.target.value })}
                        placeholder={t('professionals.invite.public.form.titlePlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.licenseNumber')}
                      </label>
                      <Input
                        value={formData.license_number || ''}
                        onChange={(e) => updateFormData({ license_number: e.target.value })}
                        placeholder={t('professionals.invite.public.form.licenseNumberPlaceholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.yearsExperience')}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={50}
                        value={formData.years_experience ?? ''}
                        onChange={(e) =>
                          updateFormData({
                            years_experience: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Portrait */}
              {currentStep === 'portrait' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <FileText className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">
                        {t('professionals.invite.public.form.portrait')}
                      </h2>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.bio')} *
                      </label>
                      <textarea
                        value={formData.bio || ''}
                        onChange={(e) => updateFormData({ bio: e.target.value })}
                        placeholder={t('professionals.invite.public.form.bioPlaceholder')}
                        rows={5}
                        className="flex w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30 focus-visible:border-sage-300 resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.approach')}
                      </label>
                      <textarea
                        value={formData.approach || ''}
                        onChange={(e) => updateFormData({ approach: e.target.value })}
                        placeholder={t('professionals.invite.public.form.approachPlaceholder')}
                        rows={5}
                        className="flex w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30 focus-visible:border-sage-300 resize-none"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          {t('professionals.invite.public.form.publicEmail')}
                        </label>
                        <Input
                          type="email"
                          value={formData.public_email || ''}
                          onChange={(e) => updateFormData({ public_email: e.target.value })}
                          placeholder={t('professionals.invite.public.form.publicEmailPlaceholder')}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          {t('professionals.invite.public.form.publicPhone')}
                        </label>
                        <Input
                          type="tel"
                          value={formData.public_phone || ''}
                          onChange={(e) => updateFormData({ public_phone: e.target.value })}
                          placeholder={t('professionals.invite.public.form.publicPhonePlaceholder')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Specialties */}
              {currentStep === 'specialties' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <Briefcase className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">
                        {t('professionals.invite.public.form.specialties')}
                      </h2>
                      <p className="text-sm text-foreground-muted">
                        {t('professionals.invite.public.form.specialtiesHelper')}
                      </p>
                    </div>
                  </div>

                  <SpecialtySelector
                    selectedSpecialties={formData.specialties || []}
                    onToggle={toggleSpecialty}
                    specialtiesByCategory={specialtiesByCategory}
                  />

                  {(formData.specialties?.length || 0) > 0 && (
                    <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
                      <span className="text-sm text-foreground-muted mr-2">Sélectionnées :</span>
                      {formData.specialties?.map((code) => (
                        <Badge key={code} variant="default">
                          {Object.values(specialtiesByCategory)
                            .flat()
                            .find((s) => s.code === code)?.name_fr || code}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Review */}
              {currentStep === 'review' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <CheckCircle2 className="h-5 w-5 text-sage-600" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">Révision</h2>
                      <p className="text-sm text-foreground-muted">
                        Vérifiez vos informations avant de soumettre
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Personal */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.personalInfo')}
                      </h3>
                      <div className="space-y-1">
                        <p className="text-foreground">{formData.full_name}</p>
                        {formData.preferred_name && (
                          <p className="text-sm text-foreground-muted">
                            Nom préféré : {formData.preferred_name}
                          </p>
                        )}
                        {formData.pronouns && (
                          <p className="text-sm text-foreground-muted">
                            Pronoms : {formData.pronouns}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Professional */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.professionalInfo')}
                      </h3>
                      <div className="space-y-1">
                        <p className="text-foreground">{formData.title}</p>
                        {formData.license_number && (
                          <p className="text-sm text-foreground-muted">
                            Permis : {formData.license_number}
                          </p>
                        )}
                        {formData.years_experience !== undefined && (
                          <p className="text-sm text-foreground-muted">
                            {formData.years_experience} années d'expérience
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Portrait */}
                    {(formData.bio || formData.approach) && (
                      <div className="rounded-xl bg-background-secondary p-4">
                        <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                          {t('professionals.invite.public.form.portrait')}
                        </h3>
                        {formData.bio && (
                          <div className="mb-2">
                            <p className="text-xs text-foreground-muted mb-1">Biographie</p>
                            <p className="text-sm text-foreground line-clamp-3">{formData.bio}</p>
                          </div>
                        )}
                        {formData.approach && (
                          <div>
                            <p className="text-xs text-foreground-muted mb-1">Approche</p>
                            <p className="text-sm text-foreground line-clamp-3">{formData.approach}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Contact */}
                    {(formData.public_email || formData.public_phone) && (
                      <div className="rounded-xl bg-background-secondary p-4">
                        <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                          {t('professionals.invite.public.form.contact')}
                        </h3>
                        <div className="space-y-1">
                          {formData.public_email && (
                            <p className="text-sm text-foreground">{formData.public_email}</p>
                          )}
                          {formData.public_phone && (
                            <p className="text-sm text-foreground">{formData.public_phone}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Specialties */}
                    {(formData.specialties?.length || 0) > 0 && (
                      <div className="rounded-xl bg-background-secondary p-4">
                        <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                          {t('professionals.invite.public.form.specialties')}
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {formData.specialties?.map((code) => (
                            <Badge key={code} variant="secondary">
                              {Object.values(specialtiesByCategory)
                                .flat()
                                .find((s) => s.code === code)?.name_fr || code}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <div>
              {!isFirstStep && (
                <Button variant="ghost" onClick={goBack}>
                  <ChevronLeft className="h-4 w-4" />
                  Retour
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isLastStep && (
                <Button
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={isSavingDraft}
                >
                  {isSavingDraft ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('professionals.invite.public.form.saveDraft')
                  )}
                </Button>
              )}

              {isLastStep ? (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('professionals.invite.public.form.submitting')}
                    </>
                  ) : (
                    t('professionals.invite.public.form.submit')
                  )}
                </Button>
              ) : (
                <Button onClick={goNext} disabled={!canProceed}>
                  Continuer
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-foreground-muted">
          {t('app.name')} &mdash; Portail professionnel
        </p>
      </div>
    </div>
  )
}
