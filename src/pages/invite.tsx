import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  Heart,
  Save,
  RefreshCw,
  Camera,
  Shield,
  FileSignature,
  Upload,
  Eye,
  Plus,
  Trash2,
  Star,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import { t, useTranslation } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  fetchInviteWithSubmissionByToken,
  markInviteOpened,
  submitQuestionnaire,
  saveDraftQuestionnaire,
  fetchSpecialtiesByCategory,
  fetchProfessionTitles,
  uploadDocumentAnon,
  getDocumentPreviewUrl,
} from '@/professionals/api'
import type { OnboardingInvite, Specialty, QuestionnaireResponses, UploadInfo, ImageRightsConsent, ProfessionTitle, QuestionnaireProfession, QuestionnaireSection, PrePopulatedData } from '@/professionals'
import { SpecialtyAccordionPicker } from '@/shared/components/specialty-accordion-picker'
import { MotifAccordionPicker } from '@/shared/components/motif-accordion-picker'
import { MotifDisclaimerBanner } from '@/motifs'

type InviteState = 'loading' | 'valid' | 'expired' | 'invalid' | 'completed' | 'already_submitted' | 'error'
type FormStep = 'personal' | 'professional' | 'portrait' | 'specialties' | 'motifs' | 'photo' | 'insurance' | 'consent' | 'review'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

const STEPS: FormStep[] = ['personal', 'professional', 'portrait', 'specialties', 'motifs', 'photo', 'insurance', 'consent', 'review']

// Image rights consent document content (v1)
const CONSENT_VERSION = 'v1'
const CONSENT_TEXT = `
## FORMULAIRE DE CONSENTEMENT AU DROIT À L'IMAGE

### 1. Objet
Par la présente, j'autorise la Clinique MANA à utiliser ma photo professionnelle à des fins de présentation de mon profil sur le site web et les supports de communication de la clinique.

### 2. Utilisation autorisée
J'accepte que ma photo soit utilisée pour :
- Mon profil professionnel sur le site web de la Clinique MANA
- La fiche professionnelle qui me sera attribuée
- Les communications internes de la clinique

### 3. Durée
Ce consentement est valide pour une période de **12 mois** à compter de la date de signature et sera **renouvelé automatiquement** pour des périodes successives de 12 mois, sauf retrait de ma part.

### 4. Droit de retrait
Je comprends que je peux retirer mon consentement à tout moment en envoyant un préavis écrit de **3 mois** à l'administration de la Clinique MANA.

### 5. Protection des données
Ma photo sera traitée conformément à la politique de confidentialité de la Clinique MANA et ne sera jamais vendue à des tiers.
`

// localStorage keys
const DRAFT_STORAGE_PREFIX = 'clinique_mana_draft_'
const SUBMISSION_ID_STORAGE_PREFIX = 'clinique_mana_submission_id_'

// Helper to format time
function formatSaveTime(date: Date): string {
  return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
}

function StepIndicator({
  currentStep,
  steps,
  isUpdateRequest,
  requestedSections,
}: {
  currentStep: FormStep
  steps: FormStep[]
  isUpdateRequest: boolean
  requestedSections: QuestionnaireSection[] | null
}) {
  const currentIndex = steps.indexOf(currentStep)

  const isSectionEditable = (step: FormStep): boolean => {
    if (!isUpdateRequest) return true
    if (step === 'review') return true
    return requestedSections?.includes(step as QuestionnaireSection) ?? false
  }

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const isActive = index === currentIndex
        const isCompleted = index < currentIndex
        const isEditable = isSectionEditable(step)

        return (
          <div key={step} className="flex items-center">
            <div
              className={`
                flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all duration-300
                ${isActive ? 'bg-sage-500 text-white scale-110' : ''}
                ${isCompleted ? 'bg-sage-100 text-sage-600' : ''}
                ${!isActive && !isCompleted ? 'bg-background-tertiary text-foreground-muted' : ''}
                ${isUpdateRequest && !isEditable && !isActive ? 'opacity-50' : ''}
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

// Read-only badge component for update requests
function ReadOnlyBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
      <Eye className="h-3 w-3" />
      {t('professionals.invite.public.updateRequest.readOnly')}
    </span>
  )
}

export function InvitePage() {
  const { token } = useParams({ strict: false }) as { token: string }

  const [state, setState] = useState<InviteState>('loading')
  const [invite, setInvite] = useState<OnboardingInvite | null>(null)
  const [displayName, setDisplayName] = useState<string>('')
  const [specialtiesByCategory, setSpecialtiesByCategory] = useState<Record<string, Specialty[]>>({})
  const [professionTitles, setProfessionTitles] = useState<ProfessionTitle[]>([])
  const [currentStep, setCurrentStep] = useState<FormStep>('personal')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Draft save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)

  // Auto-save debounce ref
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitializedRef = useRef(false)

  // Upload state
  const [photoUploadStatus, setPhotoUploadStatus] = useState<UploadStatus>('idle')
  const [insuranceUploadStatus, setInsuranceUploadStatus] = useState<UploadStatus>('idle')
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Consent state
  const [consentRead, setConsentRead] = useState(false)
  const [consentSignature, setConsentSignature] = useState('')

  // New profession form state (for adding professions in Step 2)
  const [newProfessionTitle, setNewProfessionTitle] = useState('')
  const [newProfessionLicense, setNewProfessionLicense] = useState('')

  // Update request state
  const [isUpdateRequest, setIsUpdateRequest] = useState(false)
  const [requestedSections, setRequestedSections] = useState<QuestionnaireSection[] | null>(null)

  // File input refs
  const photoInputRef = useRef<HTMLInputElement>(null)
  const insuranceInputRef = useRef<HTMLInputElement>(null)

  // Form state - initialized from localStorage if available
  const [formData, setFormData] = useState<QuestionnaireResponses>(() => {
    // Default empty form
    return {
      full_name: '',
      professions: [],
      years_experience: undefined,
      bio: '',
      approach: '',
      public_email: '',
      public_phone: '',
      specialties: [],
      motifs: [],
      uploads: undefined,
      image_rights_consent: undefined,
    }
  })

  // Load invite, specialties, and restore draft from localStorage
  useEffect(() => {
    async function loadData() {
      if (!token) {
        setState('invalid')
        return
      }

      try {
        const [inviteResult, specialties, titles] = await Promise.all([
          fetchInviteWithSubmissionByToken(token),
          fetchSpecialtiesByCategory(),
          fetchProfessionTitles(),
        ])

        if (!inviteResult) {
          setState('invalid')
          return
        }

        const inviteData = inviteResult.invite
        const professionalId = inviteData.professional_id

        // CRITICAL: Check if submission already exists (single-use enforcement)
        // This takes precedence over invite status checks
        if (inviteResult.hasExistingSubmission) {
          // Clean up localStorage since form is already submitted
          localStorage.removeItem(DRAFT_STORAGE_PREFIX + professionalId)
          localStorage.removeItem(SUBMISSION_ID_STORAGE_PREFIX + professionalId)
          setState('already_submitted')
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

        // Check if invite marked as completed (legacy check)
        if (inviteData.status === 'completed') {
          setState('completed')
          return
        }

        // Restore draft data from localStorage
        const savedDraft = localStorage.getItem(DRAFT_STORAGE_PREFIX + professionalId)
        if (savedDraft) {
          try {
            const parsed = JSON.parse(savedDraft) as QuestionnaireResponses
            setFormData(parsed)
          } catch (e) {
            console.warn('Failed to parse saved draft:', e)
          }
        }

        // Restore submission ID from localStorage
        const savedSubmissionId = localStorage.getItem(SUBMISSION_ID_STORAGE_PREFIX + professionalId)
        if (savedSubmissionId) {
          setSubmissionId(savedSubmissionId)
        }

        setInvite(inviteData)
        setDisplayName(inviteResult.displayName)
        setSpecialtiesByCategory(specialties)
        setProfessionTitles(titles)

        // Handle update request invites
        const isUpdate = inviteResult.isUpdateRequest
        setIsUpdateRequest(isUpdate)
        setRequestedSections(inviteResult.requestedSections)

        // Pre-populate form data
        if (!savedDraft) {
          if (isUpdate && inviteResult.prePopulatedData) {
            // For update requests, pre-fill with current professional data
            const prePopData = inviteResult.prePopulatedData as PrePopulatedData
            setFormData({
              full_name: inviteResult.displayName,
              professions: prePopData.professions || [],
              years_experience: prePopData.years_experience ?? undefined,
              bio: prePopData.portrait_bio || '',
              approach: prePopData.portrait_approach || '',
              public_email: prePopData.public_email || '',
              public_phone: prePopData.public_phone || '',
              specialties: prePopData.specialties || [],
              motifs: prePopData.motifs || [],
              uploads: prePopData.uploads,
              image_rights_consent: prePopData.image_rights_consent,
            })

            // If photo exists in pre-populated data, set upload status
            if (prePopData.uploads?.photo) {
              setPhotoUploadStatus('success')
            }
            if (prePopData.uploads?.insurance) {
              setInsuranceUploadStatus('success')
            }
            // If consent already exists, restore consent state
            if (prePopData.image_rights_consent?.signed) {
              setConsentRead(true)
              setConsentSignature(prePopData.image_rights_consent.signer_full_name)
            }
          } else {
            // For initial onboarding, only pre-fill name
            setFormData((prev) => ({
              ...prev,
              full_name: inviteResult.displayName,
            }))
          }
        }

        // For update requests, start on the first editable section
        if (isUpdate && inviteResult.requestedSections && inviteResult.requestedSections.length > 0) {
          const firstEditableSection = inviteResult.requestedSections[0] as FormStep
          if (STEPS.includes(firstEditableSection)) {
            setCurrentStep(firstEditableSection)
          }
        }

        // Mark as opened if pending
        if (inviteData.status === 'pending') {
          await markInviteOpened(token)
        }

        setState('valid')
        isInitializedRef.current = true
      } catch (err) {
        console.error('Error loading invite:', err)
        setState('error')
      }
    }

    loadData()
  }, [token])

  // Save to localStorage immediately on any change
  const persistToLocalStorage = useCallback((data: QuestionnaireResponses) => {
    if (!invite) return
    try {
      localStorage.setItem(DRAFT_STORAGE_PREFIX + invite.professional_id, JSON.stringify(data))
    } catch (e) {
      console.warn('Failed to save to localStorage:', e)
    }
  }, [invite])

  // Server draft save function
  const saveToServer = useCallback(async (data: QuestionnaireResponses): Promise<boolean> => {
    if (!invite) return false

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await saveDraftQuestionnaire({
        professional_id: invite.professional_id,
        invite_id: invite.id,
        responses: data,
        existing_submission_id: submissionId || undefined,
      })

      // Store submission ID for future updates
      if (result.is_new || !submissionId) {
        setSubmissionId(result.submission_id)
        localStorage.setItem(
          SUBMISSION_ID_STORAGE_PREFIX + invite.professional_id,
          result.submission_id
        )
      }

      setSaveStatus('saved')
      setLastSaveTime(new Date())
      return true
    } catch (err) {
      console.error('Failed to save draft to server:', err)
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'

      // Check for RLS error
      if (errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
        setSaveError('Ce lien ne permet pas de sauvegarder un brouillon.')
      } else {
        setSaveError('Impossible de sauvegarder le brouillon.')
      }
      setSaveStatus('error')
      return false
    }
  }, [invite, submissionId])

  // Schedule auto-save with debounce
  const scheduleAutoSave = useCallback((data: QuestionnaireResponses) => {
    if (!isInitializedRef.current) return

    // Clear any pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // Schedule new auto-save after 2.5 seconds of inactivity
    autoSaveTimerRef.current = setTimeout(() => {
      saveToServer(data)
    }, 2500)
  }, [saveToServer])

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [])

  const updateFormData = useCallback((updates: Partial<QuestionnaireResponses>) => {
    setFormData((prev) => {
      const updated = { ...prev, ...updates }
      // Persist to localStorage immediately
      persistToLocalStorage(updated)
      // Schedule auto-save to server
      scheduleAutoSave(updated)
      return updated
    })
  }, [persistToLocalStorage, scheduleAutoSave])

  const toggleSpecialty = useCallback((code: string) => {
    setFormData((prev) => {
      const current = prev.specialties || []
      const updated = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code]
      const newData = { ...prev, specialties: updated }
      persistToLocalStorage(newData)
      scheduleAutoSave(newData)
      return newData
    })
  }, [persistToLocalStorage, scheduleAutoSave])

  const toggleMotif = useCallback((key: string) => {
    setFormData((prev) => {
      const current = prev.motifs || []
      const updated = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
      const newData = { ...prev, motifs: updated }
      persistToLocalStorage(newData)
      scheduleAutoSave(newData)
      return newData
    })
  }, [persistToLocalStorage, scheduleAutoSave])

  // Photo upload handler
  const handlePhotoUpload = useCallback(async (file: File) => {
    if (!invite) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadError(t('professionals.invite.public.form.photo.errorFormat'))
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('professionals.invite.public.form.photo.errorSize'))
      return
    }

    setPhotoUploadStatus('uploading')
    setUploadError(null)

    try {
      const result = await uploadDocumentAnon(invite.professional_id, 'photo', file)

      // Create local preview
      const previewUrl = URL.createObjectURL(file)
      setPhotoPreviewUrl(previewUrl)

      // Update form data with upload info
      const uploadInfo: UploadInfo = {
        document_id: result.document_id,
        file_path: result.file_path,
        file_name: result.file_name,
        file_size: result.file_size,
        mime_type: result.mime_type,
        uploaded_at: result.uploaded_at,
      }

      setFormData((prev) => {
        const newData = {
          ...prev,
          uploads: {
            ...prev.uploads,
            photo: uploadInfo,
          },
        }
        persistToLocalStorage(newData)
        return newData
      })

      setPhotoUploadStatus('success')
    } catch (err) {
      console.error('Photo upload failed:', err)
      setUploadError(err instanceof Error ? err.message : t('professionals.invite.public.form.photo.error'))
      setPhotoUploadStatus('error')
    }
  }, [invite, persistToLocalStorage])

  // Insurance upload handler
  const handleInsuranceUpload = useCallback(async (file: File) => {
    if (!invite) return

    // Validate file type (PDF, JPEG, PNG)
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!validTypes.includes(file.type)) {
      setUploadError(t('professionals.invite.public.form.insurance.errorFormat'))
      return
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t('professionals.invite.public.form.insurance.errorSize'))
      return
    }

    setInsuranceUploadStatus('uploading')
    setUploadError(null)

    try {
      const result = await uploadDocumentAnon(invite.professional_id, 'insurance', file)

      // Update form data with upload info
      const uploadInfo: UploadInfo = {
        document_id: result.document_id,
        file_path: result.file_path,
        file_name: result.file_name,
        file_size: result.file_size,
        mime_type: result.mime_type,
        uploaded_at: result.uploaded_at,
      }

      setFormData((prev) => {
        const newData = {
          ...prev,
          uploads: {
            ...prev.uploads,
            insurance: uploadInfo,
          },
        }
        persistToLocalStorage(newData)
        return newData
      })

      setInsuranceUploadStatus('success')
    } catch (err) {
      console.error('Insurance upload failed:', err)
      setUploadError(err instanceof Error ? err.message : t('professionals.invite.public.form.insurance.error'))
      setInsuranceUploadStatus('error')
    }
  }, [invite, persistToLocalStorage])

  // Sign consent handler
  const handleSignConsent = useCallback(() => {
    if (!consentRead || !consentSignature.trim()) return

    const consent: ImageRightsConsent = {
      version: CONSENT_VERSION,
      signed: true,
      signer_full_name: consentSignature.trim(),
      signed_at: new Date().toISOString(),
      renewal_policy: '12_months_auto_renew',
      withdrawal_notice: '3_months',
    }

    setFormData((prev) => {
      const newData = {
        ...prev,
        image_rights_consent: consent,
      }
      persistToLocalStorage(newData)
      scheduleAutoSave(newData)
      return newData
    })
  }, [consentRead, consentSignature, persistToLocalStorage, scheduleAutoSave])

  // Restore consent state from formData on load
  useEffect(() => {
    if (formData.image_rights_consent?.signed) {
      setConsentRead(true)
      setConsentSignature(formData.image_rights_consent.signer_full_name)
    }
  }, [formData.image_rights_consent])

  // Restore photo preview URL if photo was already uploaded
  useEffect(() => {
    async function loadPhotoPreview() {
      if (formData.uploads?.photo?.file_path && !photoPreviewUrl) {
        try {
          const url = await getDocumentPreviewUrl(formData.uploads.photo.file_path)
          setPhotoPreviewUrl(url)
          setPhotoUploadStatus('success')
        } catch (err) {
          console.warn('Failed to load photo preview:', err)
        }
      }
    }
    loadPhotoPreview()
  }, [formData.uploads?.photo?.file_path, photoPreviewUrl])

  // Mark insurance as uploaded if already exists in formData
  useEffect(() => {
    if (formData.uploads?.insurance && insuranceUploadStatus === 'idle') {
      setInsuranceUploadStatus('success')
    }
  }, [formData.uploads?.insurance, insuranceUploadStatus])

  const currentStepIndex = STEPS.indexOf(currentStep)
  const isLastStep = currentStepIndex === STEPS.length - 1

  // For update requests, check if current step is the first editable section
  const isFirstStep = useMemo(() => {
    if (!isUpdateRequest || !requestedSections) {
      return currentStepIndex === 0
    }
    // Find the first editable section
    const firstEditableIndex = STEPS.findIndex(
      (step) => requestedSections.includes(step as QuestionnaireSection)
    )
    return currentStepIndex === firstEditableIndex
  }, [currentStepIndex, isUpdateRequest, requestedSections])

  const goNext = async () => {
    if (isLastStep) return

    // Cancel any pending auto-save and save immediately
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    // Save draft before navigating
    await saveToServer(formData)

    // For update requests, skip to next editable section
    if (isUpdateRequest) {
      for (let i = currentStepIndex + 1; i < STEPS.length; i++) {
        const step = STEPS[i]
        if (step === 'review' || requestedSections?.includes(step as QuestionnaireSection)) {
          setCurrentStep(step)
          return
        }
      }
      // If no more editable sections, go to review
      setCurrentStep('review')
    } else {
      const nextStep = STEPS[currentStepIndex + 1]
      if (nextStep) {
        setCurrentStep(nextStep)
      }
    }
  }

  const goBack = () => {
    if (isFirstStep) return

    // For update requests, skip to previous editable section
    if (isUpdateRequest) {
      for (let i = currentStepIndex - 1; i >= 0; i--) {
        const step = STEPS[i]
        if (requestedSections?.includes(step as QuestionnaireSection)) {
          setCurrentStep(step)
          return
        }
      }
      // If no previous editable section, stay on current (shouldn't happen)
    } else {
      const prevStep = STEPS[currentStepIndex - 1]
      if (prevStep) {
        setCurrentStep(prevStep)
      }
    }
  }

  // Manual save draft button handler
  const handleSaveDraft = async () => {
    if (!invite) return

    // Cancel any pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    await saveToServer(formData)
  }

  // Retry save after error
  const handleRetry = () => {
    handleSaveDraft()
  }

  const handleSubmit = async () => {
    if (!invite) return

    // Cancel any pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    setIsSubmitting(true)
    try {
      await submitQuestionnaire({
        professional_id: invite.professional_id,
        invite_id: invite.id,
        responses: formData,
        existing_submission_id: submissionId || undefined,
      })

      // Clear localStorage on successful submit
      localStorage.removeItem(DRAFT_STORAGE_PREFIX + invite.professional_id)
      localStorage.removeItem(SUBMISSION_ID_STORAGE_PREFIX + invite.professional_id)

      setState('completed')
    } catch (err) {
      console.error('Failed to submit questionnaire:', err)
      setSaveError('Impossible de soumettre le formulaire. Veuillez réessayer.')
      setSaveStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Validation per step
  const stepValidation = useMemo(() => {
    // At least one profession with both title and license is required
    const hasValidProfession = (formData.professions?.length || 0) > 0 &&
      formData.professions?.every(p => p.profession_title_key && p.license_number?.trim())

    return {
      personal: Boolean(formData.full_name?.trim()),
      professional: Boolean(hasValidProfession),
      portrait: Boolean(formData.bio?.trim()),
      specialties: true, // Optional
      motifs: true, // Optional
      photo: Boolean(formData.uploads?.photo), // Required
      insurance: Boolean(formData.uploads?.insurance), // Required
      consent: Boolean(formData.image_rights_consent?.signed), // Required
      review: true,
    }
  }, [formData])

  // Check if all required fields are complete for final submission
  const canSubmit = useMemo(() => {
    const hasValidProfession = (formData.professions?.length || 0) > 0 &&
      formData.professions?.every(p => p.profession_title_key && p.license_number?.trim())

    return (
      Boolean(formData.full_name?.trim()) &&
      Boolean(hasValidProfession) &&
      Boolean(formData.bio?.trim()) &&
      Boolean(formData.uploads?.photo) &&
      Boolean(formData.uploads?.insurance) &&
      Boolean(formData.image_rights_consent?.signed)
    )
  }, [formData])

  const canProceed = stepValidation[currentStep]

  // Helper to check if a section is editable (for update requests)
  const isSectionEditable = useCallback((step: FormStep): boolean => {
    if (!isUpdateRequest) return true // All sections editable for initial onboarding
    if (step === 'review') return true // Review is always accessible
    return requestedSections?.includes(step as QuestionnaireSection) ?? false
  }, [isUpdateRequest, requestedSections])

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

  // Single-use enforcement: Form already submitted
  if (state === 'already_submitted') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sage-50 to-background p-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-100">
              <CheckCircle2 className="h-10 w-10 text-sage-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            Merci, votre formulaire a déjà été transmis.
          </h1>
          <p className="mt-3 text-foreground-secondary">
            Votre soumission est en cours de révision par notre équipe.
            Vous serez contacté si des informations supplémentaires sont requises.
          </p>
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
            {isUpdateRequest
              ? t('professionals.invite.public.updateRequest.title')
              : t('professionals.invite.public.title')}
          </h1>
          <p className="mt-2 text-foreground-secondary">
            {isUpdateRequest
              ? t('professionals.invite.public.updateRequest.subtitle')
              : t('professionals.invite.public.subtitle')}
          </p>
          {isUpdateRequest && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-honey-100 text-honey-700 text-sm">
              <RefreshCw className="h-4 w-4" />
              {t('professionals.invite.public.updateRequest.badge')}
            </div>
          )}
        </div>

        {/* Progress */}
        <StepIndicator
          currentStep={currentStep}
          steps={STEPS}
          isUpdateRequest={isUpdateRequest}
          requestedSections={requestedSections}
        />

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
                        {t('professionals.invite.public.form.fullName')}
                      </label>
                      <Input
                        value={displayName}
                        disabled
                        className="bg-muted cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        {t('professionals.invite.public.form.email')}
                      </label>
                      <Input
                        value={invite?.email || ''}
                        disabled
                        className="bg-muted cursor-not-allowed"
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
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.professionalInfo')}
                        </h2>
                        {!isSectionEditable('professional') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('professional')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.professionsHelper')}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Existing professions */}
                    {(formData.professions || []).map((profession, index) => {
                      const title = professionTitles.find(t => t.key === profession.profession_title_key)
                      return (
                        <div
                          key={index}
                          className="rounded-xl border border-border bg-background-secondary/30 p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {title?.label_fr || profession.profession_title_key}
                              </span>
                              {profession.is_primary && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sage-100 text-xs font-medium text-sage-700">
                                  <Star className="h-3 w-3" />
                                  Principal
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {/* Set as primary (only if not primary and there are 2 professions) */}
                              {!profession.is_primary && (formData.professions?.length || 0) > 1 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const updated = formData.professions?.map((p, i) => ({
                                      ...p,
                                      is_primary: i === index,
                                    }))
                                    updateFormData({ professions: updated })
                                  }}
                                  className="h-8 px-2 text-foreground-muted hover:text-honey-600"
                                  title="Définir comme titre principal"
                                >
                                  <Star className="h-4 w-4" />
                                </Button>
                              )}
                              {/* Remove button */}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const updated = formData.professions?.filter((_, i) => i !== index) || []
                                  // If removing the primary and there's another, make it primary
                                  if (profession.is_primary && updated.length > 0 && updated[0]) {
                                    updated[0].is_primary = true
                                  }
                                  updateFormData({ professions: updated })
                                }}
                                className="h-8 px-2 text-foreground-muted hover:text-wine-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="text-sm text-foreground-muted">
                            Permis : {profession.license_number}
                          </div>
                        </div>
                      )
                    })}

                    {/* Add profession form */}
                    {(formData.professions?.length || 0) < 2 && (
                      <div className="rounded-xl border border-dashed border-border p-4 space-y-3">
                        <p className="text-sm font-medium text-foreground">
                          {(formData.professions?.length || 0) === 0
                            ? t('professionals.invite.public.form.addFirstTitle')
                            : t('professionals.invite.public.form.addSecondTitle')}
                        </p>

                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">
                            {t('professionals.invite.public.form.title')} *
                          </label>
                          <select
                            value={newProfessionTitle}
                            onChange={(e) => setNewProfessionTitle(e.target.value)}
                            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-sage-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">{t('professionals.invite.public.form.titlePlaceholder')}</option>
                            {professionTitles
                              .filter(title => !formData.professions?.some(p => p.profession_title_key === title.key))
                              .map((title) => (
                                <option key={title.key} value={title.key}>
                                  {title.label_fr}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">
                            {t('professionals.invite.public.form.licenseNumber')} *
                          </label>
                          <Input
                            value={newProfessionLicense}
                            onChange={(e) => setNewProfessionLicense(e.target.value)}
                            placeholder={t('professionals.invite.public.form.licenseNumberPlaceholder')}
                          />
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled={!newProfessionTitle || !newProfessionLicense.trim()}
                          onClick={() => {
                            if (!newProfessionTitle || !newProfessionLicense.trim()) return

                            const newProfession: QuestionnaireProfession = {
                              profession_title_key: newProfessionTitle,
                              license_number: newProfessionLicense.trim(),
                              is_primary: (formData.professions?.length || 0) === 0,
                            }

                            updateFormData({
                              professions: [...(formData.professions || []), newProfession],
                            })

                            // Reset the form
                            setNewProfessionTitle('')
                            setNewProfessionLicense('')
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1.5" />
                          Ajouter
                        </Button>
                      </div>
                    )}

                    {(formData.professions?.length || 0) >= 2 && (
                      <p className="text-xs text-foreground-muted text-center">
                        Maximum de 2 titres atteint
                      </p>
                    )}

                    <div className="pt-2 border-t border-border">
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
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.portrait')}
                        </h2>
                        {!isSectionEditable('portrait') && <ReadOnlyBadge />}
                      </div>
                      {!isSectionEditable('portrait') && (
                        <p className="text-sm text-foreground-muted">
                          {t('professionals.invite.public.updateRequest.sectionReadOnly')}
                        </p>
                      )}
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
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.specialties')}
                        </h2>
                        {!isSectionEditable('specialties') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('specialties')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.specialtiesHelper')}
                      </p>
                    </div>
                  </div>

                  <SpecialtyAccordionPicker
                    specialtiesByCategory={specialtiesByCategory}
                    selectedCodes={formData.specialties || []}
                    onToggle={toggleSpecialty}
                    disabled={!isSectionEditable('specialties')}
                  />
                </div>
              )}

              {/* Step 5: Motifs */}
              {currentStep === 'motifs' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <Heart className="h-5 w-5 text-sage-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.motifs')}
                        </h2>
                        {!isSectionEditable('motifs') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('motifs')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.motifsHelper')}
                      </p>
                    </div>
                  </div>

                  <MotifDisclaimerBanner />

                  <MotifAccordionPicker
                    selectedKeys={formData.motifs || []}
                    onToggle={toggleMotif}
                    disabled={!isSectionEditable('motifs')}
                  />
                </div>
              )}

              {/* Step 6: Photo */}
              {currentStep === 'photo' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <Camera className="h-5 w-5 text-sage-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.photo.title')}
                        </h2>
                        {!isSectionEditable('photo') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('photo')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.photo.description')}
                      </p>
                    </div>
                  </div>

                  {/* Photo Preview / Upload Zone */}
                  <div className="flex flex-col items-center gap-4">
                    {photoPreviewUrl ? (
                      <div className="relative">
                        <div className="w-48 h-48 rounded-full overflow-hidden border-4 border-sage-200 shadow-soft">
                          <img
                            src={photoPreviewUrl}
                            alt={t('professionals.invite.public.form.photo.preview')}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="absolute bottom-0 right-0 rounded-full"
                          onClick={() => photoInputRef.current?.click()}
                          disabled={photoUploadStatus === 'uploading'}
                        >
                          {photoUploadStatus === 'uploading' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={photoUploadStatus === 'uploading'}
                        className="w-48 h-48 rounded-full border-2 border-dashed border-border hover:border-sage-300 bg-background-secondary hover:bg-background-tertiary transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer"
                      >
                        {photoUploadStatus === 'uploading' ? (
                          <>
                            <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
                            <span className="text-sm text-foreground-muted">
                              {t('professionals.invite.public.form.photo.uploading')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Upload className="h-8 w-8 text-foreground-muted" />
                            <span className="text-sm text-foreground-muted text-center px-4">
                              {t('professionals.invite.public.form.photo.dropzone')}
                            </span>
                          </>
                        )}
                      </button>
                    )}

                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoUpload(file)
                      }}
                    />

                    <p className="text-xs text-foreground-muted text-center">
                      {t('professionals.invite.public.form.photo.requirements')}
                    </p>

                    {uploadError && currentStep === 'photo' && (
                      <div className="flex items-center gap-2 text-sm text-wine-600 bg-wine-50 px-3 py-2 rounded-lg">
                        <AlertCircle className="h-4 w-4" />
                        {uploadError}
                      </div>
                    )}

                    {photoUploadStatus === 'success' && (
                      <div className="flex items-center gap-2 text-sm text-sage-600">
                        <CheckCircle2 className="h-4 w-4" />
                        {t('professionals.invite.public.form.photo.success')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 7: Insurance */}
              {currentStep === 'insurance' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <Shield className="h-5 w-5 text-sage-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.insurance.title')}
                        </h2>
                        {!isSectionEditable('insurance') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('insurance')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.insurance.description')}
                      </p>
                    </div>
                  </div>

                  {/* Insurance Upload Zone */}
                  <div className="flex flex-col items-center gap-4">
                    {formData.uploads?.insurance ? (
                      <div className="w-full p-4 rounded-xl bg-sage-50 border border-sage-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sage-100">
                              <FileText className="h-5 w-5 text-sage-600" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">
                                {formData.uploads.insurance.file_name}
                              </p>
                              <p className="text-xs text-foreground-muted">
                                {Math.round((formData.uploads.insurance.file_size || 0) / 1024)} Ko
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => insuranceInputRef.current?.click()}
                            disabled={insuranceUploadStatus === 'uploading'}
                          >
                            {t('professionals.invite.public.form.insurance.change')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => insuranceInputRef.current?.click()}
                        disabled={insuranceUploadStatus === 'uploading'}
                        className="w-full p-8 rounded-xl border-2 border-dashed border-border hover:border-sage-300 bg-background-secondary hover:bg-background-tertiary transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer"
                      >
                        {insuranceUploadStatus === 'uploading' ? (
                          <>
                            <Loader2 className="h-10 w-10 animate-spin text-sage-500" />
                            <span className="text-foreground-muted">
                              {t('professionals.invite.public.form.insurance.uploading')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Upload className="h-10 w-10 text-foreground-muted" />
                            <span className="text-foreground-muted">
                              {t('professionals.invite.public.form.insurance.dropzone')}
                            </span>
                          </>
                        )}
                      </button>
                    )}

                    <input
                      ref={insuranceInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleInsuranceUpload(file)
                      }}
                    />

                    <p className="text-xs text-foreground-muted text-center">
                      {t('professionals.invite.public.form.insurance.requirements')}
                    </p>

                    {uploadError && currentStep === 'insurance' && (
                      <div className="flex items-center gap-2 text-sm text-wine-600 bg-wine-50 px-3 py-2 rounded-lg">
                        <AlertCircle className="h-4 w-4" />
                        {uploadError}
                      </div>
                    )}

                    {insuranceUploadStatus === 'success' && (
                      <div className="flex items-center gap-2 text-sm text-sage-600">
                        <CheckCircle2 className="h-4 w-4" />
                        {t('professionals.invite.public.form.insurance.success')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 8: Consent */}
              {currentStep === 'consent' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 pb-4 border-b border-border">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sage-100">
                      <FileSignature className="h-5 w-5 text-sage-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-foreground">
                          {t('professionals.invite.public.form.consent.title')}
                        </h2>
                        {!isSectionEditable('consent') && <ReadOnlyBadge />}
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {!isSectionEditable('consent')
                          ? t('professionals.invite.public.updateRequest.sectionReadOnly')
                          : t('professionals.invite.public.form.consent.description')}
                      </p>
                    </div>
                  </div>

                  {/* Consent Document */}
                  <div className="rounded-xl border border-border bg-background-secondary p-6 max-h-64 overflow-y-auto">
                    <div className="prose prose-sm prose-sage max-w-none">
                      {CONSENT_TEXT.split('\n').map((line, i) => {
                        if (line.startsWith('## ')) {
                          return <h2 key={i} className="text-lg font-semibold mt-4 mb-2">{line.replace('## ', '')}</h2>
                        }
                        if (line.startsWith('### ')) {
                          return <h3 key={i} className="text-base font-medium mt-3 mb-1">{line.replace('### ', '')}</h3>
                        }
                        if (line.startsWith('- ')) {
                          return <li key={i} className="ml-4">{line.replace('- ', '')}</li>
                        }
                        if (line.includes('**')) {
                          return (
                            <p key={i} className="my-1">
                              {line.split(/(\*\*.*?\*\*)/).map((part, j) =>
                                part.startsWith('**') && part.endsWith('**')
                                  ? <strong key={j}>{part.replace(/\*\*/g, '')}</strong>
                                  : part
                              )}
                            </p>
                          )
                        }
                        return line.trim() ? <p key={i} className="my-1">{line}</p> : null
                      })}
                    </div>
                  </div>

                  {/* Consent Info Banner */}
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-honey-50 border border-honey-200">
                    <Eye className="h-5 w-5 text-honey-600 mt-0.5" />
                    <div className="text-sm text-honey-800">
                      <p className="font-medium mb-1">{t('professionals.invite.public.form.consent.documentVersion')} {CONSENT_VERSION}</p>
                      <p>{t('professionals.invite.public.form.consent.renewalPolicy')}</p>
                      <p>{t('professionals.invite.public.form.consent.withdrawalNotice')}</p>
                    </div>
                  </div>

                  {/* Checkbox to confirm read */}
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="consent-read"
                      checked={consentRead}
                      onCheckedChange={(checked: boolean | 'indeterminate') => setConsentRead(checked === true)}
                      disabled={Boolean(formData.image_rights_consent?.signed)}
                    />
                    <label htmlFor="consent-read" className="text-sm text-foreground cursor-pointer">
                      {t('professionals.invite.public.form.consent.readDocument')}
                    </label>
                  </div>

                  {/* Signature field */}
                  {consentRead && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-4 pt-4 border-t border-border"
                    >
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          {t('professionals.invite.public.form.consent.signature.label')} *
                        </label>
                        <Input
                          value={consentSignature}
                          onChange={(e) => setConsentSignature(e.target.value)}
                          placeholder={t('professionals.invite.public.form.consent.signature.placeholder')}
                          disabled={Boolean(formData.image_rights_consent?.signed)}
                        />
                        <p className="text-xs text-foreground-muted mt-1">
                          {t('professionals.invite.public.form.consent.signature.helper')}
                        </p>
                      </div>

                      {!formData.image_rights_consent?.signed && consentSignature.trim() && (
                        <Button
                          type="button"
                          onClick={handleSignConsent}
                          className="w-full"
                        >
                          <FileSignature className="h-4 w-4 mr-2" />
                          {t('professionals.invite.public.form.consent.checkboxLabel')}
                        </Button>
                      )}

                      {formData.image_rights_consent?.signed && (
                        <div className="flex items-center gap-2 p-4 rounded-xl bg-sage-50 border border-sage-200">
                          <CheckCircle2 className="h-5 w-5 text-sage-600" />
                          <div>
                            <p className="font-medium text-sage-700">
                              {t('professionals.invite.public.form.consent.signed')}
                            </p>
                            <p className="text-sm text-sage-600">
                              {t('professionals.invite.public.form.consent.signature.date')}: {formatClinicDateShort(formData.image_rights_consent.signed_at)}
                            </p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              )}

              {/* Step 9: Review */}
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
                        <p className="text-foreground">{displayName}</p>
                        <p className="text-sm text-foreground-muted">{invite?.email}</p>
                      </div>
                    </div>

                    {/* Professional */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.professionalInfo')}
                      </h3>
                      <div className="space-y-2">
                        {formData.professions?.map((profession, index) => {
                          const title = professionTitles.find(t => t.key === profession.profession_title_key)
                          return (
                            <div key={index} className="flex items-center gap-2">
                              <span className="text-foreground">{title?.label_fr || profession.profession_title_key}</span>
                              {profession.is_primary && (formData.professions?.length || 0) > 1 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sage-100 text-[10px] font-medium text-sage-700">
                                  <Star className="h-2.5 w-2.5" />
                                  Principal
                                </span>
                              )}
                              <span className="text-sm text-foreground-muted">
                                — Permis : {profession.license_number}
                              </span>
                            </div>
                          )
                        })}
                        {formData.years_experience !== undefined && (
                          <p className="text-sm text-foreground-muted pt-1">
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

                    {/* Motifs */}
                    {(formData.motifs?.length || 0) > 0 && (
                      <div className="rounded-xl bg-background-secondary p-4">
                        <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                          {t('professionals.invite.public.form.motifs')}
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {formData.motifs?.map((key) => (
                            <Badge key={key} variant="secondary">
                              {key}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Photo */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.review.sections.photo')}
                      </h3>
                      <div className="flex items-center gap-3">
                        {formData.uploads?.photo ? (
                          <>
                            {photoPreviewUrl && (
                              <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-sage-200">
                                <img
                                  src={photoPreviewUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-sage-600" />
                              <span className="text-sm text-sage-600">
                                {t('professionals.invite.public.form.review.uploaded')}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-wine-500" />
                            <span className="text-sm text-wine-600">
                              {t('professionals.invite.public.form.review.notUploaded')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Insurance */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.review.sections.insurance')}
                      </h3>
                      <div className="flex items-center gap-3">
                        {formData.uploads?.insurance ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-sage-600" />
                            <span className="text-sm text-sage-600">
                              {t('professionals.invite.public.form.review.uploaded')} — {formData.uploads.insurance.file_name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-wine-500" />
                            <span className="text-sm text-wine-600">
                              {t('professionals.invite.public.form.review.notUploaded')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Consent */}
                    <div className="rounded-xl bg-background-secondary p-4">
                      <h3 className="text-sm font-medium text-foreground-secondary mb-2">
                        {t('professionals.invite.public.form.review.sections.consent')}
                      </h3>
                      <div className="flex items-center gap-3">
                        {formData.image_rights_consent?.signed ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-sage-600" />
                            <span className="text-sm text-sage-600">
                              {t('professionals.invite.public.form.review.signed')} — {formData.image_rights_consent.signer_full_name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-wine-500" />
                            <span className="text-sm text-wine-600">
                              {t('professionals.invite.public.form.review.notSigned')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Validation summary */}
                    {!canSubmit && (
                      <div className="rounded-xl bg-wine-50 border border-wine-200 p-4">
                        <div className="flex items-center gap-2 text-wine-700">
                          <AlertCircle className="h-5 w-5" />
                          <span className="font-medium">
                            {t('professionals.invite.public.form.review.missingRequired')}
                          </span>
                        </div>
                        <ul className="mt-2 ml-7 text-sm text-wine-600 space-y-1">
                          {!formData.full_name?.trim() && (
                            <li>• {t('professionals.invite.public.form.fullName')}</li>
                          )}
                          {(!(formData.professions?.length) || !formData.professions?.every(p => p.profession_title_key && p.license_number?.trim())) && (
                            <li>• {t('professionals.invite.public.form.title')} / {t('professionals.invite.public.form.licenseNumber')}</li>
                          )}
                          {!formData.bio?.trim() && (
                            <li>• {t('professionals.invite.public.form.bio')}</li>
                          )}
                          {!formData.uploads?.photo && (
                            <li>• {t('professionals.invite.public.form.validation.photoRequired')}</li>
                          )}
                          {!formData.uploads?.insurance && (
                            <li>• {t('professionals.invite.public.form.validation.insuranceRequired')}</li>
                          )}
                          {!formData.image_rights_consent?.signed && (
                            <li>• {t('professionals.invite.public.form.validation.consentRequired')}</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {canSubmit && (
                      <div className="rounded-xl bg-sage-50 border border-sage-200 p-4">
                        <div className="flex items-center gap-2 text-sage-700">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="font-medium">
                            {t('professionals.invite.public.form.review.allComplete')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Save Status Indicator */}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-foreground-muted min-h-[24px]">
            <AnimatePresence mode="wait">
              {saveStatus === 'saving' && (
                <motion.div
                  key="saving"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Sauvegarde…</span>
                </motion.div>
              )}
              {saveStatus === 'saved' && lastSaveTime && (
                <motion.div
                  key="saved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-sage-600"
                >
                  <Save className="h-3 w-3" />
                  <span>Sauvegardé à {formatSaveTime(lastSaveTime)}</span>
                </motion.div>
              )}
              {saveStatus === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-wine-600"
                >
                  <AlertCircle className="h-3 w-3" />
                  <span>{saveError}</span>
                  <button
                    onClick={handleRetry}
                    className="flex items-center gap-1 text-sage-600 hover:text-sage-700 underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Réessayer
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-6">
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
                  disabled={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-1">Sauvegarde…</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span className="ml-1">{t('professionals.invite.public.form.saveDraft')}</span>
                    </>
                  )}
                </Button>
              )}

              {isLastStep ? (
                <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
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
