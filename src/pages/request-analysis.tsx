import { useState } from 'react'
import { Link, useRouterState, useNavigate } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  FileText,
  Lightbulb,
  Loader2,
} from 'lucide-react'
import { t } from '@/i18n'
import { Badge } from '@/shared/ui/badge'
import { useToast } from '@/shared/hooks/use-toast'
import type { MotifKey } from '@/shared/components/motif-selector'
import { useAuth } from '@/auth'
import { useDemande, useAssignDemande } from '@/demandes'
import { createAppointment } from '@/availability/api'
import {
  RecommendationsPanel,
  ProfessionalProfileDialog,
  SlotSelectionDrawer,
  type AvailableSlot,
  type SchedulePreferences,
} from '@/recommendations/components'

const urgencyConfig = {
  low: { variant: 'success' as const, label: 'pages.requestDetail.urgency.levels.low' },
  moderate: { variant: 'warning' as const, label: 'pages.requestDetail.urgency.levels.moderate' },
  high: { variant: 'error' as const, label: 'pages.requestDetail.urgency.levels.high' },
}

export function RequestAnalysisPage() {
  // Get request ID from router
  const routerState = useRouterState()
  const navigate = useNavigate()
  const requestId = (routerState.matches.at(-1)?.params as { id?: string })?.id ?? ''
  const isDraft = requestId === 'nouvelle'

  // Auth and toast
  const { profile } = useAuth()
  const { toast } = useToast()

  // Fetch demande data
  const { data: demandeData, isLoading } = useDemande(isDraft ? undefined : requestId)

  // Assignment mutation
  const assignDemande = useAssignDemande()

  // Get motif label from translation
  const getMotifLabel = (key: MotifKey) =>
    t(`pages.requestDetail.motifs.list.${key}.label` as Parameters<typeof t>[0])

  // Get enjeu label from translation
  const getEnjeuxLabel = (key: string) =>
    t(`pages.requestDetail.motifs.intake.enjeux.options.${key}` as Parameters<typeof t>[0])

  // Get legal context label from translation
  const getLegalContextLabel = (key: string) =>
    t(`pages.requestDetail.motifs.intake.legalContext.options.${key}` as Parameters<typeof t>[0])

  // Professional profile dialog state
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [viewingProfessionalId, setViewingProfessionalId] = useState<string | null>(null)

  // Slot selection drawer state - stores the professional being assigned
  const [slotDrawerProfessional, setSlotDrawerProfessional] = useState<{
    professionalId: string
    displayName: string
  } | null>(null)

  // Handle viewing a professional's profile
  const handleViewProfile = (professionalId: string) => {
    setViewingProfessionalId(professionalId)
    setProfileDialogOpen(true)
  }

  // Handle selecting a professional - opens slot selection drawer directly
  const handleSelectProfessional = (professionalId: string, displayName?: string) => {
    setSlotDrawerProfessional({
      professionalId,
      displayName: displayName || 'Professionnel sélectionné',
    })
    // Close the profile dialog if open
    setProfileDialogOpen(false)
  }

  // Handle slot selection - create appointment and assign demande
  const handleSlotSelected = async (slot: AvailableSlot) => {
    // Validate required data
    if (!slotDrawerProfessional || !demandeData || !profile) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: 'Données manquantes pour créer le rendez-vous.',
      })
      return
    }

    // Get client IDs from demande participants
    const clientIds = demandeData.participants.map((p) => p.clientId)
    if (clientIds.length === 0) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: 'Aucun client associé à cette demande.',
      })
      return
    }

    try {
      // Step 1: Create the appointment using service from slot
      await createAppointment({
        professionalId: slotDrawerProfessional.professionalId,
        serviceId: slot.serviceId,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        clientIds,
        status: 'created',
      })

      // Step 2: Assign the professional to the demande
      await assignDemande.mutateAsync({
        demandeId: requestId,
        professionalId: slotDrawerProfessional.professionalId,
        assignedBy: profile.id,
      })

      // Success!
      toast({
        title: 'Rendez-vous créé',
        description: `${slot.serviceName} avec ${slotDrawerProfessional.displayName}. La demande a été assignée.`,
      })

      // Close the drawer and reset state
      setSlotDrawerProfessional(null)

      // Navigate back to demandes list or detail
      navigate({ to: '/demandes/$id', params: { id: requestId } })
    } catch (error) {
      console.error('Assignment error:', error)
      toast({
        variant: 'error',
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Impossible de créer le rendez-vous.',
      })
    }
  }

  // Show loading state
  if (!isDraft && isLoading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
          <p className="text-sm text-foreground-muted">Chargement de l'analyse...</p>
        </div>
      </div>
    )
  }

  // Extract data from fetched demande or use empty values
  const selectedMotifs = (demandeData?.selectedMotifs || []) as MotifKey[]
  const besoinRaison = demandeData?.besoinRaison || ''
  const enjeuxDemarche = demandeData?.enjeuxDemarche || []
  const enjeuxComment = demandeData?.enjeuxComment || ''
  const legalContext = demandeData?.legalContext || []
  const legalContextDetail = demandeData?.legalContextDetail || ''
  const urgency = (demandeData?.urgency || '') as 'low' | 'moderate' | 'high' | ''
  const demandeId = demandeData?.demandeId || ''
  const demandType = demandeData?.demandType as 'individual' | 'couple' | 'family' | 'group' | null
  const schedulePreferences = (demandeData?.schedulePreferences || []) as SchedulePreferences
  const schedulePreferenceDetail = demandeData?.schedulePreferenceDetail || ''
  const diagnosticStatus = demandeData?.diagnosticStatus || ''
  const diagnosticDetail = demandeData?.diagnosticDetail || ''
  const hasConsulted = demandeData?.hasConsulted || ''
  const consultationsPrevious = demandeData?.consultationsPrevious || []
  const consultationsComment = demandeData?.consultationsComment || ''

  // Get schedule preference label from translation
  const getScheduleLabel = (key: string) =>
    t(`pages.requestAnalysis.summary.scheduleOptions.${key}` as Parameters<typeof t>[0])

  // Get consultation type label
  const getConsultationLabel = (key: string) =>
    t(`pages.requestDetail.motifs.intake.consultations.options.${key}` as Parameters<typeof t>[0])

  return (
    <div className="min-h-full">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-10 -mx-6 -mt-6 mb-6 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4"
      >
        {/* Back link */}
        <Link
          to="/demandes/$id"
          params={{ id: requestId }}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('pages.requestAnalysis.backToRequest')}
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.requestAnalysis.title')}
          </h1>
          {!isDraft && demandeId && (
            <p className="text-xs text-foreground-muted font-mono">{demandeId}</p>
          )}
        </div>
      </motion.header>

      {/* Main content - Responsive layout */}
      {/* Mobile (<1024px): single column stacked (Résumé first) */}
      {/* lg (1024px+): 2 columns - Résumé left, Recommendations right */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left zone: Résumé de la demande (read-only) */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
        >
          {/* Section header */}
          <div className="bg-sage-50/50 border-b border-sage-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-sage-100 p-1.5">
                <FileText className="h-3.5 w-3.5 text-sage-600" />
              </div>
              <h2 className="text-sm font-semibold text-sage-700">
                {t('pages.requestAnalysis.summary.title')}
              </h2>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Motifs exprimés */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.motifs')}
              </p>
              {selectedMotifs.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedMotifs.map((motif) => (
                    <Badge key={motif} variant="default" className="text-xs">
                      {getMotifLabel(motif)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noMotifs')}
                </p>
              )}
            </div>

            {/* Besoin identifié */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.besoin')}
              </p>
              {besoinRaison ? (
                <p className="text-sm text-foreground leading-relaxed">
                  {besoinRaison}
                </p>
              ) : (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noBesoin')}
                </p>
              )}
            </div>

            {/* Préférences horaires */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.schedulePreferences')}
              </p>
              {schedulePreferences.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {schedulePreferences.map((pref) => (
                      <Badge key={pref} variant="outline" className="text-xs">
                        {getScheduleLabel(pref)}
                      </Badge>
                    ))}
                  </div>
                  {schedulePreferenceDetail && (
                    <p className="text-xs text-foreground-secondary italic">
                      {schedulePreferenceDetail}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noSchedulePreferences')}
                </p>
              )}
            </div>

            {/* Enjeux */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.enjeux')}
              </p>
              {enjeuxDemarche.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {enjeuxDemarche.map((enjeu) => (
                      <Badge key={enjeu} variant="secondary" className="text-xs">
                        {getEnjeuxLabel(enjeu)}
                      </Badge>
                    ))}
                  </div>
                  {enjeuxComment && (
                    <p className="text-xs text-foreground-secondary italic">
                      {enjeuxComment}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noEnjeux')}
                </p>
              )}
            </div>

            {/* Diagnostic */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.diagnostic')}
              </p>
              {diagnosticStatus === 'yes' ? (
                <div className="space-y-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {t('pages.requestAnalysis.summary.hasDiagnosis')}
                  </Badge>
                  {diagnosticDetail && (
                    <p className="text-xs text-foreground-secondary">
                      {diagnosticDetail}
                    </p>
                  )}
                </div>
              ) : diagnosticStatus === 'no' ? (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noDiagnosis')}
                </p>
              ) : (
                <p className="text-sm text-foreground-muted italic">—</p>
              )}
            </div>

            {/* Historique de consultation */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.consultationHistory')}
              </p>
              {hasConsulted === 'yes' ? (
                <div className="space-y-1.5">
                  <Badge variant="outline" className="text-xs">
                    {t('pages.requestAnalysis.summary.hasConsulted')}
                  </Badge>
                  {consultationsPrevious.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {consultationsPrevious.map((consult) => (
                        <span key={consult} className="text-xs text-foreground-secondary">
                          {getConsultationLabel(consult)}
                        </span>
                      ))}
                    </div>
                  )}
                  {consultationsComment && (
                    <p className="text-xs text-foreground-secondary italic">
                      {consultationsComment}
                    </p>
                  )}
                </div>
              ) : hasConsulted === 'no' ? (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.hasNotConsulted')}
                </p>
              ) : (
                <p className="text-sm text-foreground-muted italic">—</p>
              )}
            </div>

            {/* Contexte légal */}
            {(legalContext.length > 0 || legalContextDetail) && (
              <div>
                <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                  {t('pages.requestAnalysis.summary.legalContext')}
                </p>
                <div className="space-y-1.5">
                  {legalContext.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {legalContext.map((context) => (
                        <Badge key={context} variant="warning" className="text-xs">
                          {getLegalContextLabel(context)}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {legalContextDetail && (
                    <p className="text-xs text-foreground-secondary italic">
                      {legalContextDetail}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Urgence perçue */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.urgency')}
              </p>
              {urgency ? (
                <Badge
                  variant={urgencyConfig[urgency].variant}
                  className="text-xs"
                >
                  {t(urgencyConfig[urgency].label as Parameters<typeof t>[0])}
                </Badge>
              ) : (
                <p className="text-sm text-foreground-muted italic">—</p>
              )}
            </div>
          </div>
        </motion.section>

        {/* Main zone: Recommandations + Actions (grouped on lg, split on xl) */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
        >
          {/* Section header */}
          <div className="bg-honey-50/50 border-b border-honey-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-honey-100 p-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-honey-600" />
              </div>
              <h2 className="text-sm font-semibold text-honey-700">
                {t('pages.requestAnalysis.recommendations.title')}
              </h2>
            </div>
          </div>

          <div className="p-5">
            {!isDraft && requestId ? (
              <RecommendationsPanel
                demandeId={requestId}
                onViewProfile={handleViewProfile}
                onSelectProfessional={handleSelectProfessional}
              />
            ) : (
              /* Empty state for drafts */
              <div className="rounded-xl border border-dashed border-border bg-background-secondary/30 p-8 text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-honey-50 flex items-center justify-center">
                  <Lightbulb className="h-6 w-6 text-honey-400" />
                </div>
                <p className="text-sm text-foreground-secondary leading-relaxed mb-2">
                  {t('pages.requestAnalysis.recommendations.empty')}
                </p>
                <p className="text-xs text-foreground-muted">
                  {t('pages.requestAnalysis.recommendations.helper')}
                </p>
              </div>
            )}
          </div>
        </motion.section>
      </div>

      {/* Professional Profile Dialog */}
      <ProfessionalProfileDialog
        professionalId={viewingProfessionalId}
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        onSelect={(id, displayName) => handleSelectProfessional(id, displayName)}
      />

      {/* Slot Selection Drawer - opens directly when a professional is selected */}
      {slotDrawerProfessional && (
        <SlotSelectionDrawer
          open={!!slotDrawerProfessional}
          onOpenChange={(open) => !open && setSlotDrawerProfessional(null)}
          professionalId={slotDrawerProfessional.professionalId}
          professionalName={slotDrawerProfessional.displayName}
          onSelectSlot={handleSlotSelected}
          schedulePreferences={schedulePreferences}
          demandType={demandType}
        />
      )}
    </div>
  )
}
