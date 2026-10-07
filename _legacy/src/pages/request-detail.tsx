import { useState, useEffect } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Clock,
  User,
  Users,
  MessageSquare,
  AlertCircle,
  ClipboardList,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ExternalLink,
  Plus,
  X,
  Crown,
  Heart,
  Home,
  UsersRound,
  ChevronDown,
  Check,
  Info,
  FileText,
  Loader2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Textarea } from '@/shared/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { toast } from '@/shared/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { MotifSelector, type MotifKey } from '@/shared/components/motif-selector'
import { ClientPickerDrawer } from '@/shared/components/client-picker-drawer'
import {
  getBackNavigation,
  type DetailPageSearchParams,
} from '@/shared/lib/navigation'
import { useCreateDemande, useUpdateDemande, useDemande } from '@/demandes'
import type { CreateDemandeInput } from '@/demandes'

type RequestStatus = 'toAnalyze' | 'assigned' | 'closed'
type ConsentStatus = 'valid' | 'expired' | 'missing'
type ParticipantRole = 'principal' | 'participant'
type DemandType = 'individual' | 'couple' | 'family' | 'group'

interface ClientConsent {
  status: ConsentStatus
  version?: string
  signedDate?: string
}

interface RequestParticipant {
  id: string
  clientId: string
  name: string
  role: ParticipantRole
  consent: ClientConsent
}

const consentStatusConfig: Record<
  ConsentStatus,
  {
    variant: 'success' | 'warning' | 'error'
    icon: typeof ShieldCheck
    labelKey: string
  }
> = {
  valid: {
    variant: 'success',
    icon: ShieldCheck,
    labelKey: 'pages.requestDetail.consent.status.valid',
  },
  expired: {
    variant: 'warning',
    icon: ShieldAlert,
    labelKey: 'pages.requestDetail.consent.status.expired',
  },
  missing: {
    variant: 'error',
    icon: ShieldX,
    labelKey: 'pages.requestDetail.consent.status.missing',
  },
}

const statusConfig: Record<
  RequestStatus,
  { variant: 'warning' | 'success' | 'secondary'; labelKey: string }
> = {
  toAnalyze: { variant: 'warning', labelKey: 'pages.requestDetail.status.toAnalyze' },
  assigned: { variant: 'success', labelKey: 'pages.requestDetail.status.assigned' },
  closed: { variant: 'secondary', labelKey: 'pages.requestDetail.status.closed' },
}

// Demand type configuration with participant rules
const demandTypeConfig: Record<
  DemandType,
  {
    minParticipants: number
    maxParticipants: number | null // null = unlimited
    icon: 'user' | 'users'
    disabled?: boolean
  }
> = {
  individual: { minParticipants: 1, maxParticipants: 1, icon: 'user' },
  couple: { minParticipants: 2, maxParticipants: 2, icon: 'users' },
  family: { minParticipants: 2, maxParticipants: null, icon: 'users' },
  group: { minParticipants: 3, maxParticipants: null, icon: 'users', disabled: true },
}

function formatDateShort(dateString: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString))
}

export function RequestDetailPage() {
  // Get navigation context from router state
  const routerState = useRouterState()
  const navigate = useNavigate()
  const searchParams = routerState.location.search as DetailPageSearchParams
  const requestId = (routerState.matches.at(-1)?.params as { id?: string })?.id ?? ''
  const backNav = getBackNavigation(searchParams, 'requests')

  // Determine if this is a new/draft request
  const isDraft = requestId === 'nouvelle'

  // Fetch existing demande data
  const { data: demandeData, isLoading: isLoadingDemande } = useDemande(isDraft ? undefined : requestId)

  // Client context state (motifs)
  const [selectedMotifs, setSelectedMotifs] = useState<MotifKey[]>([])
  const [motifDescription, setMotifDescription] = useState('')
  const [otherMotifText, setOtherMotifText] = useState('')

  // Intake questions state (client-stated, local state only)
  const [besoinRaison, setBesoinRaison] = useState('')
  // Enjeux: Oui/Non then options
  const [enjeuxHasIssues, setEnjeuxHasIssues] = useState<'yes' | 'no' | ''>('')
  const [enjeuxDemarche, setEnjeuxDemarche] = useState<string[]>([])
  const [enjeuxComment, setEnjeuxComment] = useState('')
  // Diagnostic: just Oui/Non
  const [diagnosticStatus, setDiagnosticStatus] = useState<'yes' | 'no' | ''>('')
  const [diagnosticDetail, setDiagnosticDetail] = useState('')
  // Consultations: Oui/Non then options
  const [hasConsulted, setHasConsulted] = useState<'yes' | 'no' | ''>('')
  const [consultationsPrevious, setConsultationsPrevious] = useState<string[]>([])
  const [consultationsComment, setConsultationsComment] = useState('')
  // Legal: Oui/Non then options
  const [hasLegalContext, setHasLegalContext] = useState<'yes' | 'no' | ''>('')
  const [legalContext, setLegalContext] = useState<string[]>([])
  const [legalContextDetail, setLegalContextDetail] = useState('')
  // Schedule preferences (multi-select)
  const [schedulePreferences, setSchedulePreferences] = useState<Array<'am' | 'pm' | 'evening' | 'weekend' | 'other'>>([])
  const [schedulePreferenceDetail, setSchedulePreferenceDetail] = useState('')

  // Internal evaluation state
  const [notes, setNotes] = useState('')
  const [urgency, setUrgency] = useState('')

  // Participants state
  const [participants, setParticipants] = useState<RequestParticipant[]>([])
  const [clientPickerOpen, setClientPickerOpen] = useState(false)
  const [participantToRemove, setParticipantToRemove] = useState<RequestParticipant | null>(null)

  // Demand type state
  const [demandType, setDemandType] = useState<DemandType | null>(null)

  // Track if we've initialized from fetched data
  const [hasInitialized, setHasInitialized] = useState(false)

  // Mutations
  const createDemande = useCreateDemande()
  const updateDemande = useUpdateDemande()

  // Populate form state when demande data loads
  useEffect(() => {
    if (demandeData && !hasInitialized) {
      // Motifs
      setSelectedMotifs(demandeData.selectedMotifs as MotifKey[])
      setMotifDescription(demandeData.motifDescription)
      setOtherMotifText(demandeData.otherMotifText)

      // Demand type
      setDemandType(demandeData.demandType)

      // Intake fields
      setBesoinRaison(demandeData.besoinRaison)
      setEnjeuxHasIssues(demandeData.enjeuxHasIssues || '')
      setEnjeuxDemarche(demandeData.enjeuxDemarche)
      setEnjeuxComment(demandeData.enjeuxComment)
      setDiagnosticStatus(demandeData.diagnosticStatus || '')
      setDiagnosticDetail(demandeData.diagnosticDetail)
      setHasConsulted(demandeData.hasConsulted || '')
      setConsultationsPrevious(demandeData.consultationsPrevious)
      setConsultationsComment(demandeData.consultationsComment)
      setHasLegalContext(demandeData.hasLegalContext || '')
      setLegalContext(demandeData.legalContext)
      setLegalContextDetail(demandeData.legalContextDetail)
      setSchedulePreferences(demandeData.schedulePreferences || [])
      setSchedulePreferenceDetail(demandeData.schedulePreferenceDetail || '')

      // Internal evaluation
      setNotes(demandeData.notes)
      setUrgency(demandeData.urgency || '')

      // Participants - map from API format to component format
      setParticipants(demandeData.participants.map(p => ({
        id: p.id,
        clientId: p.clientId,
        name: p.clientName,
        role: p.role,
        consent: {
          status: p.consentStatus,
          version: p.consentVersion || undefined,
          signedDate: p.consentSignedAt || undefined,
        },
      })))

      setHasInitialized(true)
    }
  }, [demandeData, hasInitialized])

  // Compute request status info
  const requestStatus: RequestStatus = demandeData?.status || 'toAnalyze'
  const statusInfo = statusConfig[requestStatus]

  // Get demand type config for validation
  const typeConfig = demandType ? demandTypeConfig[demandType] : null

  // Validate participant count against demand type rules
  const participantCountValid = typeConfig
    ? participants.length >= typeConfig.minParticipants &&
      (typeConfig.maxParticipants === null || participants.length <= typeConfig.maxParticipants)
    : false

  // Check if can add more participants based on type
  const canAddMoreParticipants =
    demandType !== null &&
    requestStatus !== 'closed' &&
    demandType !== 'group' &&
    typeConfig !== null &&
    (typeConfig.maxParticipants === null || participants.length < typeConfig.maxParticipants)

  // Get primary client name for header
  const primaryClient = participants.find((p) => p.role === 'principal')
  const clientDisplayName = primaryClient?.name || t('pages.requestDetail.clientNotCreated')

  // Check consent for ALL participants
  const participantsWithInvalidConsent = participants.filter(
    (p) => p.consent.status !== 'valid'
  )
  const allConsentsValid = participantsWithInvalidConsent.length === 0

  const canAnalyze = requestStatus === 'toAnalyze'
  const canClose = requestStatus !== 'closed'

  // Get participant validation state - always returns the same rule message, only state changes
  const getParticipantValidationState = (): { message: string; state: 'info' | 'warning' | 'valid' } | null => {
    if (!demandType) return null

    const count = participants.length

    switch (demandType) {
      case 'individual': {
        // Rule: exactly 1 person - same message always
        const message = t('pages.requestDetail.participants.validation.individual.exact')
        if (count === 1) return { message, state: 'valid' }
        if (count === 0) return { message, state: 'info' }
        return { message, state: 'warning' }
      }

      case 'couple': {
        // Rule: exactly 2 people - same message always
        const message = t('pages.requestDetail.participants.validation.couple.required')
        if (count === 2) return { message, state: 'valid' }
        if (count === 0) return { message, state: 'info' }
        return { message, state: 'warning' }
      }

      case 'family': {
        // Rule: at least 2 people - same message always
        const message = t('pages.requestDetail.participants.validation.family.minimum')
        if (count >= 2) return { message, state: 'valid' }
        if (count === 0) return { message, state: 'info' }
        return { message, state: 'warning' }
      }

      case 'group':
        return { message: t('pages.requestDetail.participants.validation.group.comingSoon'), state: 'info' }

      default:
        return null
    }
  }

  const participantValidation = getParticipantValidationState()

  // Handle adding a client to the request (from drawer)
  const handleAddClient = (client: {
    id: string
    firstName: string
    lastName: string
    consent: { status: 'valid' | 'expired' | 'missing' }
  }) => {
    const isFirstParticipant = participants.length === 0
    const newParticipant: RequestParticipant = {
      id: `part-${Date.now()}`,
      clientId: client.id,
      name: `${client.firstName} ${client.lastName}`,
      role: isFirstParticipant ? 'principal' : 'participant',
      consent: client.consent,
    }
    setParticipants([...participants, newParticipant])
    setClientPickerOpen(false)
  }

  // Handle creating a new client (from drawer)
  // The client is now already created in the database by ClientPickerDrawer
  const handleCreateClient = (client: {
    id: string // Real UUID from database
    firstName: string
    lastName: string
    dateOfBirth?: string
    email?: string
    phone?: string
    consent: { status: 'valid' | 'expired' | 'missing' }
  }) => {
    const isFirstParticipant = participants.length === 0
    const newParticipant: RequestParticipant = {
      id: `part-${Date.now()}`,
      clientId: client.id, // Use real UUID from database
      name: `${client.firstName} ${client.lastName}`,
      role: isFirstParticipant ? 'principal' : 'participant',
      consent: client.consent,
    }
    setParticipants([...participants, newParticipant])
    setClientPickerOpen(false)
  }

  // Handle removing a participant (with confirmation dialog)
  const handleRemoveParticipant = (participant: RequestParticipant) => {
    setParticipantToRemove(participant)
  }

  // Confirm removal from dialog
  const confirmRemoveParticipant = () => {
    if (!participantToRemove) return

    let remainingParticipants = participants.filter((p) => p.id !== participantToRemove.id)

    // If removing principal and there are other participants, promote the first remaining
    if (participantToRemove.role === 'principal' && remainingParticipants.length > 0) {
      remainingParticipants = remainingParticipants.map((p, index) =>
        index === 0 ? { ...p, role: 'principal' as const } : p
      )
    }

    setParticipants(remainingParticipants)
    setParticipantToRemove(null)
  }

  // Show loading state while fetching existing demande
  if (!isDraft && isLoadingDemande) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
          <p className="text-sm text-foreground-muted">Chargement de la demande...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Sticky Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-10 -mx-6 -mt-6 mb-6 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4"
      >
        {/* Back link - context-aware */}
        <Link
          to={backNav.to as '/demandes' | '/clients/$id'}
          params={backNav.params as { id: string } | undefined}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t(backNav.labelKey as Parameters<typeof t>[0])}
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {/* Title + Status + Demand Type */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-foreground">
                {isDraft ? t('pages.requestDetail.titleNew') : t('pages.requestDetail.title')}
              </h1>
              {isDraft ? (
                <Badge variant="secondary">
                  {t('pages.requestDetail.draft.badge')}
                </Badge>
              ) : (
                <Badge variant={statusInfo.variant}>
                  {t(statusInfo.labelKey as Parameters<typeof t>[0])}
                </Badge>
              )}

              {/* Demand Type Selector */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-7 gap-1.5 text-xs font-medium',
                      demandType
                        ? 'border-sage-200 bg-sage-50 text-sage-700 hover:bg-sage-100'
                        : 'border-honey-300 bg-honey-50 text-honey-700 hover:bg-honey-100'
                    )}
                    disabled={requestStatus === 'closed'}
                  >
                    {demandType === 'individual' && <User className="h-3.5 w-3.5" />}
                    {demandType === 'couple' && <Heart className="h-3.5 w-3.5" />}
                    {demandType === 'family' && <Home className="h-3.5 w-3.5" />}
                    {demandType === 'group' && <UsersRound className="h-3.5 w-3.5" />}
                    {!demandType && <Users className="h-3.5 w-3.5" />}
                    {demandType
                      ? t(`pages.requestDetail.demandType.types.${demandType}` as Parameters<typeof t>[0])
                      : t('pages.requestDetail.demandType.placeholder')}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground-secondary px-2 py-1">
                      {t('pages.requestDetail.demandType.title')}
                    </p>
                    {(['individual', 'couple', 'family', 'group'] as const).map((type) => {
                      const config = demandTypeConfig[type]
                      const isSelected = demandType === type
                      const isDisabled = config.disabled

                      return (
                        <button
                          key={type}
                          onClick={() => !isDisabled && setDemandType(type)}
                          disabled={isDisabled}
                          className={cn(
                            'w-full flex items-start gap-3 p-2 rounded-lg text-left transition-colors',
                            isSelected
                              ? 'bg-sage-50 border border-sage-200'
                              : isDisabled
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-background-secondary'
                          )}
                        >
                          <div
                            className={cn(
                              'shrink-0 mt-0.5 h-4 w-4 rounded border flex items-center justify-center',
                              isSelected
                                ? 'bg-sage-500 border-sage-500'
                                : 'border-border bg-background'
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {type === 'individual' && <User className="h-3.5 w-3.5 text-foreground-muted" />}
                              {type === 'couple' && <Heart className="h-3.5 w-3.5 text-foreground-muted" />}
                              {type === 'family' && <Home className="h-3.5 w-3.5 text-foreground-muted" />}
                              {type === 'group' && <UsersRound className="h-3.5 w-3.5 text-foreground-muted" />}
                              <span className={cn('text-sm font-medium', isSelected && 'text-sage-700')}>
                                {t(`pages.requestDetail.demandType.types.${type}` as Parameters<typeof t>[0])}
                              </span>
                            </div>
                            <p className="text-xs text-foreground-muted mt-0.5">
                              {t(`pages.requestDetail.demandType.descriptions.${type}` as Parameters<typeof t>[0])}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                    <p className="text-xs text-foreground-muted px-2 pt-2 border-t border-border mt-2">
                      {t('pages.requestDetail.demandType.helper')}
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {/* Client name + participant count */}
            <p className="text-foreground-secondary">
              {participants.length === 0
                ? t('pages.requestDetail.draft.noClient')
                : clientDisplayName}
              {participants.length > 1 && (
                <span className="text-foreground-muted ml-1">
                  (+{participants.length - 1})
                </span>
              )}
            </p>
            {/* Request ID - only show for existing requests */}
            {!isDraft && demandeData && (
              <p className="text-xs text-foreground-muted font-mono">{demandeData.demandeId}</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Close button - only for existing requests */}
            {canClose && !isDraft && (
              <Button variant="outline" size="sm">
                {t('pages.requestDetail.actions.close')}
              </Button>
            )}
            {/* Save Draft button - always visible for drafts and editable requests */}
            {(isDraft || canAnalyze) && (
              <Button
                variant="outline"
                size="sm"
                disabled={createDemande.isPending || updateDemande.isPending}
                onClick={async () => {
                  const demandeInput: CreateDemandeInput = {
                    demandType,
                    selectedMotifs,
                    motifDescription,
                    otherMotifText,
                    urgency: urgency as 'low' | 'moderate' | 'high' | null || null,
                    notes,
                    besoinRaison,
                    enjeuxHasIssues: enjeuxHasIssues as 'yes' | 'no' | '',
                    enjeuxDemarche,
                    enjeuxComment,
                    diagnosticStatus: diagnosticStatus as 'yes' | 'no' | '',
                    diagnosticDetail,
                    hasConsulted: hasConsulted as 'yes' | 'no' | '',
                    consultationsPrevious,
                    consultationsComment,
                    hasLegalContext: hasLegalContext as 'yes' | 'no' | '',
                    legalContext,
                    legalContextDetail,
                    schedulePreferences,
                    schedulePreferenceDetail,
                    participants: participants.map(p => ({
                      clientId: p.clientId,
                      role: p.role,
                      consentStatus: p.consent.status,
                      consentVersion: p.consent.version,
                      consentSignedAt: p.consent.signedDate,
                    })),
                  }

                  try {
                    if (isDraft) {
                      // Create new demande
                      const result = await createDemande.mutateAsync(demandeInput)
                      toast({
                        title: 'Demande créée',
                        description: `La demande ${result.demandeId} a été créée.`,
                      })
                      // Navigate to the new demande
                      navigate({ to: '/demandes/$id', params: { id: result.demandeId } })
                    } else {
                      // Update existing demande
                      await updateDemande.mutateAsync({
                        demandeId: requestId,
                        updates: demandeInput,
                      })
                      toast({
                        title: 'Demande sauvegardée',
                        description: 'Les modifications ont été enregistrées.',
                      })
                    }
                  } catch (error) {
                    console.error('Error saving demande:', error)
                    toast({
                      title: 'Erreur',
                      description: 'Impossible de sauvegarder la demande.',
                      variant: 'error',
                    })
                  }
                }}
              >
                {(createDemande.isPending || updateDemande.isPending) ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    {t('pages.requestDetail.actions.saving')}
                  </>
                ) : (
                  t('pages.requestDetail.actions.saveDraft')
                )}
              </Button>
            )}
            {/* Analyser button - navigates to analysis page */}
            {canAnalyze && (
              <Button
                size="sm"
                onClick={() => {
                  if (isDraft) {
                    // TODO: Save draft first, then navigate
                    console.log('Saving draft before analysis...')
                  }
                  navigate({ to: '/demandes/$id/analyse', params: { id: isDraft ? 'nouvelle' : requestId } })
                }}
              >
                {t('pages.requestDetail.actions.analyze')}
              </Button>
            )}
          </div>
        </div>
      </motion.header>

      {/* Main content - Two column layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left column - CONTEXT + EVALUATION (primary, wider) */}
        <div className="lg:col-span-3 space-y-6">
          {/* ===== CLIENT CONTEXT SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header: Contexte client */}
            <div className="bg-sage-50/50 border-b border-sage-100 px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-sage-100 p-1.5">
                  <User className="h-3.5 w-3.5 text-sage-600" />
                </div>
                <h2 className="text-sm font-semibold text-sage-700">
                  {t('pages.requestDetail.motifs.sectionLabel')}
                </h2>
              </div>
            </div>

            {/* Motif selector */}
            <div className="p-5">
              <MotifSelector
                selectedMotifs={selectedMotifs}
                onMotifsChange={setSelectedMotifs}
                description={motifDescription}
                onDescriptionChange={setMotifDescription}
                otherText={otherMotifText}
                onOtherTextChange={setOtherMotifText}
                readOnly={requestStatus === 'closed'}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-sage-100" />

            {/* Intake questions - Client-stated information */}
            <div className="p-5 space-y-6">
              {/* A) Besoin / raison de la demande (required) */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('pages.requestDetail.motifs.intake.besoin.label')}
                </label>
                <Textarea
                  value={besoinRaison}
                  onChange={(e) => setBesoinRaison(e.target.value)}
                  placeholder={t('pages.requestDetail.motifs.intake.besoin.placeholder')}
                  disabled={requestStatus === 'closed'}
                  className="min-h-[100px]"
                />
                <p className="text-xs text-foreground-muted">
                  {t('pages.requestDetail.motifs.intake.besoin.helper')}
                </p>
              </div>

              {/* B) Enjeux de la démarche (Oui/Non first, then options) */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('pages.requestDetail.motifs.intake.enjeux.label')}
                </label>
                {/* Oui/Non toggle */}
                <div className="flex flex-wrap gap-2">
                  {(['yes', 'no'] as const).map((option) => {
                    const isSelected = enjeuxHasIssues === option
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (requestStatus === 'closed') return
                          setEnjeuxHasIssues(option)
                          if (option === 'no') {
                            setEnjeuxDemarche([])
                            setEnjeuxComment('')
                          }
                        }}
                        disabled={requestStatus === 'closed'}
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-full border transition-all',
                          isSelected
                            ? 'bg-sage-100 border-sage-300 text-sage-700'
                            : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                          requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                        {t(`pages.requestDetail.motifs.intake.yesNo.${option}` as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
                {/* Options shown when Oui is selected */}
                <AnimatePresence>
                  {enjeuxHasIssues === 'yes' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        {(['coparenting', 'other'] as const).map((option) => {
                          const isSelected = enjeuxDemarche.includes(option)
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                if (requestStatus === 'closed') return
                                if (isSelected) {
                                  setEnjeuxDemarche(enjeuxDemarche.filter((e) => e !== option))
                                } else {
                                  setEnjeuxDemarche([...enjeuxDemarche, option])
                                }
                              }}
                              disabled={requestStatus === 'closed'}
                              className={cn(
                                'px-3 py-1.5 text-sm rounded-full border transition-all',
                                isSelected
                                  ? 'bg-sage-100 border-sage-300 text-sage-700'
                                  : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                                requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                              )}
                            >
                              {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                              {t(`pages.requestDetail.motifs.intake.enjeux.options.${option}` as Parameters<typeof t>[0])}
                            </button>
                          )
                        })}
                      </div>
                      {/* Comment input - always shown when any option is selected */}
                      {enjeuxDemarche.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground-muted">
                            {t('pages.requestDetail.motifs.intake.enjeux.commentInput.label')}
                          </label>
                          <input
                            type="text"
                            value={enjeuxComment}
                            onChange={(e) => setEnjeuxComment(e.target.value)}
                            placeholder={t('pages.requestDetail.motifs.intake.enjeux.commentInput.placeholder')}
                            disabled={requestStatus === 'closed'}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sage-500/30 focus:border-sage-300 disabled:opacity-50"
                          />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-foreground-muted">
                  {t('pages.requestDetail.motifs.intake.enjeux.helper')}
                </p>
              </div>

              {/* C) Diagnostic ou évaluation (just Oui/Non) */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('pages.requestDetail.motifs.intake.diagnostic.label')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['yes', 'no'] as const).map((option) => {
                    const isSelected = diagnosticStatus === option
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (requestStatus === 'closed') return
                          setDiagnosticStatus(option)
                          if (option === 'no') setDiagnosticDetail('')
                        }}
                        disabled={requestStatus === 'closed'}
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-full border transition-all',
                          isSelected
                            ? 'bg-sage-100 border-sage-300 text-sage-700'
                            : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                          requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                        {t(`pages.requestDetail.motifs.intake.yesNo.${option}` as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
                {/* Progressive disclosure: Show detail input when "Oui" is selected */}
                <AnimatePresence>
                  {diagnosticStatus === 'yes' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-1.5"
                    >
                      <label className="text-xs font-medium text-foreground-muted">
                        {t('pages.requestDetail.motifs.intake.diagnostic.detailInput.label')}
                      </label>
                      <input
                        type="text"
                        value={diagnosticDetail}
                        onChange={(e) => setDiagnosticDetail(e.target.value)}
                        placeholder={t('pages.requestDetail.motifs.intake.diagnostic.detailInput.placeholder')}
                        disabled={requestStatus === 'closed'}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sage-500/30 focus:border-sage-300 disabled:opacity-50"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-foreground-muted flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  {t('pages.requestDetail.motifs.intake.diagnostic.helper')}
                </p>
              </div>

              {/* D) Consultations antérieures (Oui/Non first, then options) */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('pages.requestDetail.motifs.intake.consultations.label')}
                </label>
                {/* Oui/Non toggle */}
                <div className="flex flex-wrap gap-2">
                  {(['yes', 'no'] as const).map((option) => {
                    const isSelected = hasConsulted === option
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (requestStatus === 'closed') return
                          setHasConsulted(option)
                          if (option === 'no') {
                            setConsultationsPrevious([])
                            setConsultationsComment('')
                          }
                        }}
                        disabled={requestStatus === 'closed'}
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-full border transition-all',
                          isSelected
                            ? 'bg-sage-100 border-sage-300 text-sage-700'
                            : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                          requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                        {t(`pages.requestDetail.motifs.intake.yesNo.${option}` as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
                {/* Options shown when Oui is selected */}
                <AnimatePresence>
                  {hasConsulted === 'yes' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        {(['psychologist', 'socialWorker', 'psychoeducator', 'doctor', 'other'] as const).map((option) => {
                          const isSelected = consultationsPrevious.includes(option)
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                if (requestStatus === 'closed') return
                                if (isSelected) {
                                  setConsultationsPrevious(consultationsPrevious.filter((c) => c !== option))
                                } else {
                                  setConsultationsPrevious([...consultationsPrevious, option])
                                }
                              }}
                              disabled={requestStatus === 'closed'}
                              className={cn(
                                'px-3 py-1.5 text-sm rounded-full border transition-all',
                                isSelected
                                  ? 'bg-sage-100 border-sage-300 text-sage-700'
                                  : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                                requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                              )}
                            >
                              {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                              {t(`pages.requestDetail.motifs.intake.consultations.options.${option}` as Parameters<typeof t>[0])}
                            </button>
                          )
                        })}
                      </div>
                      {/* Comment input - shown when any option is selected */}
                      {consultationsPrevious.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground-muted">
                            {t('pages.requestDetail.motifs.intake.consultations.commentInput.label')}
                          </label>
                          <input
                            type="text"
                            value={consultationsComment}
                            onChange={(e) => setConsultationsComment(e.target.value)}
                            placeholder={t('pages.requestDetail.motifs.intake.consultations.commentInput.placeholder')}
                            disabled={requestStatus === 'closed'}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sage-500/30 focus:border-sage-300 disabled:opacity-50"
                          />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* E) Contexte légal / judiciaire (Oui/Non first, then options) */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('pages.requestDetail.motifs.intake.legalContext.label')}
                </label>
                {/* Oui/Non toggle */}
                <div className="flex flex-wrap gap-2">
                  {(['yes', 'no'] as const).map((option) => {
                    const isSelected = hasLegalContext === option
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (requestStatus === 'closed') return
                          setHasLegalContext(option)
                          if (option === 'no') {
                            setLegalContext([])
                            setLegalContextDetail('')
                          }
                        }}
                        disabled={requestStatus === 'closed'}
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-full border transition-all',
                          isSelected
                            ? 'bg-sage-100 border-sage-300 text-sage-700'
                            : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                          requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                        {t(`pages.requestDetail.motifs.intake.yesNo.${option}` as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
                {/* Options shown when Oui is selected */}
                <AnimatePresence>
                  {hasLegalContext === 'yes' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        {(['courtOrder', 'youthProtection'] as const).map((option) => {
                          const isSelected = legalContext.includes(option)
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                if (requestStatus === 'closed') return
                                if (isSelected) {
                                  setLegalContext(legalContext.filter((c) => c !== option))
                                } else {
                                  setLegalContext([...legalContext, option])
                                }
                              }}
                              disabled={requestStatus === 'closed'}
                              className={cn(
                                'px-3 py-1.5 text-sm rounded-full border transition-all',
                                isSelected
                                  ? 'bg-sage-100 border-sage-300 text-sage-700'
                                  : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                                requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                              )}
                            >
                              {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                              {t(`pages.requestDetail.motifs.intake.legalContext.options.${option}` as Parameters<typeof t>[0])}
                            </button>
                          )
                        })}
                      </div>
                      {/* Detail textarea - shown when any option is selected */}
                      {legalContext.length > 0 && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground-muted">
                            {t('pages.requestDetail.motifs.intake.legalContext.detailInput.label')}
                          </label>
                          <Textarea
                            value={legalContextDetail}
                            onChange={(e) => setLegalContextDetail(e.target.value)}
                            disabled={requestStatus === 'closed'}
                            className="min-h-[80px]"
                          />
                          <p className="text-xs text-foreground-muted">
                            {t('pages.requestDetail.motifs.intake.legalContext.detailInput.helper')}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* F) Préférence horaire */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                  {t('demandes.schedulePreference.label')}
                </label>
                {/* Schedule preferences options (multi-select) */}
                <div className="flex flex-wrap gap-2">
                  {(['am', 'pm', 'evening', 'weekend', 'other'] as const).map((option) => {
                    const isSelected = schedulePreferences.includes(option)
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (requestStatus === 'closed') return
                          if (isSelected) {
                            setSchedulePreferences(schedulePreferences.filter(p => p !== option))
                            if (option === 'other') setSchedulePreferenceDetail('')
                          } else {
                            setSchedulePreferences([...schedulePreferences, option])
                          }
                        }}
                        disabled={requestStatus === 'closed'}
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-full border transition-all',
                          isSelected
                            ? 'bg-sage-100 border-sage-300 text-sage-700'
                            : 'bg-background border-border text-foreground-secondary hover:bg-background-secondary',
                          requestStatus === 'closed' && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {isSelected && <Check className="inline h-3 w-3 mr-1.5" />}
                        {t(`demandes.schedulePreference.options.${option}` as Parameters<typeof t>[0])}
                      </button>
                    )
                  })}
                </div>
                {/* Detail textarea - shown when "Autre" is selected */}
                <AnimatePresence>
                  {schedulePreferences.includes('other') && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-1.5"
                    >
                      <label className="text-xs font-medium text-foreground-muted">
                        {t('demandes.schedulePreference.detail.label')}
                      </label>
                      <Textarea
                        value={schedulePreferenceDetail}
                        onChange={(e) => setSchedulePreferenceDetail(e.target.value)}
                        placeholder={t('demandes.schedulePreference.detail.placeholder')}
                        disabled={requestStatus === 'closed'}
                        className="min-h-[80px]"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-foreground-muted">
                  Aide à filtrer les créneaux proposés
                </p>
              </div>
            </div>
          </motion.section>
        </div>

        {/* Right column - ORIENTATION & INTERNAL EVALUATION (secondary, narrower) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section: Personnes concernées */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header */}
            <div className="bg-sage-50/50 border-b border-sage-100 px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-sage-100 p-1.5">
                    <Users className="h-3.5 w-3.5 text-sage-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-sage-700">
                        {t('pages.requestDetail.participants.title')}
                      </h2>
                      <Badge variant="secondary" className="text-xs">
                        {participants.length}
                      </Badge>
                    </div>
                    <p className="text-xs text-sage-600">
                      {t('pages.requestDetail.participants.subtitle')}
                    </p>
                  </div>
                </div>

                {/* Add client button - only show when allowed by type rules */}
                {canAddMoreParticipants && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setClientPickerOpen(true)}
                  >
                    <Plus className="h-3 w-3" />
                    {t('pages.requestDetail.participants.addClient')}
                  </Button>
                )}
              </div>
            </div>

            {/* Participants list */}
            <div className="p-4 space-y-3">
              {/* Empty state - show when no participants */}
              {participants.length === 0 && (
                <div className="rounded-xl border border-dashed border-sage-200 bg-sage-50/30 p-6">
                  <div className="text-center">
                    <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-sage-100 flex items-center justify-center">
                      <User className="h-5 w-5 text-sage-500" />
                    </div>
                    <p className="text-sm text-foreground-secondary mb-4">
                      {demandType
                        ? t(`pages.requestDetail.participants.emptyWithType.${demandType}` as Parameters<typeof t>[0])
                        : t('pages.requestDetail.participants.emptyNoType')}
                    </p>
                    {/* CTA button - only show when demand type allows adding */}
                    {demandType && demandType !== 'group' && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setClientPickerOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        {t('pages.requestDetail.participants.addClient')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Participants cards */}
              <AnimatePresence mode="popLayout">
                {participants.map((participant) => {
                  const consentInfo = consentStatusConfig[participant.consent.status]
                  const ConsentIcon = consentInfo.icon
                  const isPrincipal = participant.role === 'principal'

                  return (
                    <motion.div
                      key={participant.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        'rounded-xl border p-4',
                        participant.consent.status === 'valid'
                          ? 'border-sage-200 bg-sage-50/30'
                          : participant.consent.status === 'expired'
                            ? 'border-honey-200 bg-honey-50/30'
                            : 'border-wine-200 bg-wine-50/30'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Name + Role */}
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-foreground">
                              {participant.name}
                            </span>
                            <Badge
                              variant={isPrincipal ? 'default' : 'secondary'}
                              className="text-xs gap-1"
                            >
                              {isPrincipal && <Crown className="h-3 w-3" />}
                              {t(
                                `pages.requestDetail.participants.roles.${participant.role}` as Parameters<
                                  typeof t
                                >[0]
                              )}
                            </Badge>
                          </div>

                          {/* Consent status */}
                          <div className="flex items-center gap-2 mt-2">
                            <ConsentIcon
                              className={cn(
                                'h-4 w-4',
                                participant.consent.status === 'valid' && 'text-sage-600',
                                participant.consent.status === 'expired' && 'text-honey-600',
                                participant.consent.status === 'missing' && 'text-wine-600'
                              )}
                            />
                            <Badge variant={consentInfo.variant} className="text-xs">
                              {t(consentInfo.labelKey as Parameters<typeof t>[0])}
                            </Badge>
                            {participant.consent.version && participant.consent.signedDate && (
                              <span className="text-xs text-foreground-muted">
                                {t('pages.requestDetail.consent.version')}
                                {participant.consent.version} ·{' '}
                                {formatDateShort(participant.consent.signedDate)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <Link
                            to="/clients/$id"
                            params={{ id: participant.clientId }}
                            search={{ from: 'request', fromId: requestId }}
                            className="p-1.5 rounded-lg text-foreground-muted hover:text-sage-600 hover:bg-sage-50 transition-colors"
                            title={t('pages.requestDetail.participants.viewProfile')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                          {requestStatus === 'toAnalyze' && (
                            <button
                              onClick={() => handleRemoveParticipant(participant)}
                              className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground-secondary hover:bg-background-tertiary transition-colors"
                              title={t('pages.requestDetail.participants.remove')}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>

              {/* Persistent validation message - always visible when demand type selected */}
              {participantValidation && (
                <div
                  className={cn(
                    'mt-3 rounded-lg border p-3 transition-colors duration-200',
                    participantValidation.state === 'valid'
                      ? 'border-sage-200 bg-sage-50/50'
                      : participantValidation.state === 'warning'
                        ? 'border-honey-200 bg-honey-50/30'
                        : 'border-border bg-background-secondary/50'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {participantValidation.state === 'valid' ? (
                      <Check className="h-4 w-4 shrink-0 mt-0.5 text-sage-600" />
                    ) : participantValidation.state === 'warning' ? (
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-honey-600" />
                    ) : (
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-foreground-muted" />
                    )}
                    <p
                      className={cn(
                        'text-sm transition-colors duration-200',
                        participantValidation.state === 'valid'
                          ? 'text-sage-700'
                          : participantValidation.state === 'warning'
                            ? 'text-honey-700'
                            : 'text-foreground-secondary'
                      )}
                    >
                      {participantValidation.message}
                    </p>
                  </div>
                </div>
              )}

              {/* Consent status message - only show when participant count is valid */}
              {participantCountValid && participants.length > 0 && (
                <div
                  className={cn(
                    'mt-2 rounded-lg border p-3 transition-colors duration-200',
                    allConsentsValid
                      ? 'border-sage-200 bg-sage-50/50'
                      : 'border-wine-200 bg-wine-50/30'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {allConsentsValid ? (
                      <Check className="h-4 w-4 shrink-0 mt-0.5 text-sage-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-wine-600" />
                    )}
                    <p
                      className={cn(
                        'text-sm transition-colors duration-200',
                        allConsentsValid ? 'text-sage-700' : 'text-wine-700'
                      )}
                    >
                      {allConsentsValid
                        ? t('pages.requestDetail.participants.consentComplete')
                        : t('pages.requestDetail.participants.consentWarning')}
                    </p>
                  </div>
                </div>
              )}

              {/* Helper text - only show when participants exist */}
              {participants.length > 0 && (
                <div className="mt-4 pt-3 border-t border-sage-100">
                  <p className="text-xs text-foreground-muted">
                    {t('pages.requestDetail.participants.helper')}
                  </p>
                </div>
              )}
            </div>
          </motion.section>

          {/* Section: Statut de la demande */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-xl border border-border bg-background p-5 shadow-soft"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="rounded-lg bg-sage-100 p-2">
                <FileText className="h-4 w-4 text-sage-600" />
              </div>
              <h2 className="font-semibold text-foreground">
                {t('pages.requestStatus.title')}
              </h2>
            </div>

            <div className="space-y-4">
              {/* Status badge */}
              <div className="flex items-center gap-2">
                <Badge variant={isDraft ? 'secondary' : statusInfo.variant}>
                  {isDraft
                    ? t('pages.requestDetail.draft.badge')
                    : t(statusInfo.labelKey as Parameters<typeof t>[0])}
                </Badge>
              </div>

              {/* Helper text */}
              <p className="text-sm text-foreground-secondary">
                {isDraft
                  ? t('pages.requestStatus.saveFirst')
                  : t('pages.requestStatus.helper')}
              </p>

              {/* No demand type selected message */}
              {!demandType && (
                <div className="rounded-lg border border-border bg-background-secondary/50 p-3">
                  <p className="text-xs text-foreground-muted">
                    {t('pages.requestDetail.draft.selectTypeFirst')}
                  </p>
                </div>
              )}
            </div>
          </motion.section>

          {/* ===== INTERNAL EVALUATION SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header: Évaluation interne */}
            <div className="bg-honey-50/50 border-b border-honey-100 px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-honey-100 p-1.5">
                  <ClipboardList className="h-3.5 w-3.5 text-honey-600" />
                </div>
                <h2 className="text-sm font-semibold text-honey-700">
                  Évaluation interne
                </h2>
              </div>
            </div>

            <div className="p-5 space-y-6">
              {/* Notes d'appel / Intake */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4 text-foreground-muted" />
                  <h3 className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.notes.title')}
                  </h3>
                </div>

                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('pages.requestDetail.notes.placeholder')}
                  className="min-h-[120px] mb-2"
                />
                <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3" />
                  {t('pages.requestDetail.notes.helper')}
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Urgence perçue */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-foreground-muted" />
                  <h3 className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.urgency.title')}
                  </h3>
                </div>

                {/* Urgency selector - styled as segmented control */}
                <div className="flex gap-2 mb-2">
                  {(['low', 'moderate', 'high'] as const).map((level) => {
                    const isSelected = urgency === level
                    const levelColors = {
                      low: 'border-sage-300 bg-sage-50 text-sage-700',
                      moderate: 'border-honey-300 bg-honey-50 text-honey-700',
                      high: 'border-wine-300 bg-wine-50 text-wine-700',
                    }
                    return (
                      <button
                        key={level}
                        onClick={() => setUrgency(level)}
                        className={cn(
                          'flex-1 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all',
                          isSelected
                            ? levelColors[level]
                            : 'border-border bg-background-secondary text-foreground-secondary hover:bg-background-tertiary'
                        )}
                      >
                        {t(
                          `pages.requestDetail.urgency.levels.${level}` as Parameters<
                            typeof t
                          >[0]
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-foreground-muted">
                  {t('pages.requestDetail.urgency.helper')}
                </p>
              </div>
            </div>
          </motion.section>
        </div>
      </div>

      {/* Client Picker Drawer */}
      <ClientPickerDrawer
        open={clientPickerOpen}
        onOpenChange={setClientPickerOpen}
        onSelectClient={handleAddClient}
        onCreateClient={handleCreateClient}
        excludeClientIds={participants.map((p) => p.clientId)}
      />

      {/* Remove Participant Confirmation Dialog */}
      <Dialog open={!!participantToRemove} onOpenChange={(open) => !open && setParticipantToRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('pages.requestDetail.participants.removeDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('pages.requestDetail.participants.removeDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setParticipantToRemove(null)}
            >
              {t('pages.requestDetail.participants.removeDialog.cancel')}
            </Button>
            <Button
              variant="outline"
              onClick={confirmRemoveParticipant}
            >
              {t('pages.requestDetail.participants.removeDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
