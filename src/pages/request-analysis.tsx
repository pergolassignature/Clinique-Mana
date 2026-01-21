import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  FileText,
  Lightbulb,
  UserCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { MotifKey } from '@/shared/components/motif-selector'
import { useDemande } from '@/demandes'
import { RecommendationsPanel, ProfessionalProfileDialog } from '@/recommendations/components'

const urgencyConfig = {
  low: { variant: 'success' as const, label: 'pages.requestDetail.urgency.levels.low' },
  moderate: { variant: 'warning' as const, label: 'pages.requestDetail.urgency.levels.moderate' },
  high: { variant: 'error' as const, label: 'pages.requestDetail.urgency.levels.high' },
}

export function RequestAnalysisPage() {
  // Get request ID from router
  const routerState = useRouterState()
  const requestId = (routerState.matches.at(-1)?.params as { id?: string })?.id ?? ''
  const isDraft = requestId === 'nouvelle'

  // Fetch demande data
  const { data: demandeData, isLoading } = useDemande(isDraft ? undefined : requestId)

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
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null)

  // Handle viewing a professional's profile
  const handleViewProfile = (professionalId: string) => {
    setSelectedProfessionalId(professionalId)
    setProfileDialogOpen(true)
  }

  // Handle selecting a professional for assignment
  const handleSelectProfessional = (professionalId: string) => {
    // TODO: Implement professional assignment flow
    // For now, just log and show a message
    console.log('Selected professional for assignment:', professionalId)
    // This will be connected to the assignment system later
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
  const legalContext = demandeData?.legalContext || []
  const urgency = (demandeData?.urgency || '') as 'low' | 'moderate' | 'high' | ''
  const demandeId = demandeData?.demandeId || ''

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

      {/* Main content - Three zone layout */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left zone: Résumé de la demande (read-only) */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-3 rounded-xl border border-border bg-background shadow-soft overflow-hidden"
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

            {/* Enjeux */}
            <div>
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                {t('pages.requestAnalysis.summary.enjeux')}
              </p>
              {enjeuxDemarche.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {enjeuxDemarche.map((enjeu) => (
                    <Badge key={enjeu} variant="secondary" className="text-xs">
                      {getEnjeuxLabel(enjeu)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted italic">
                  {t('pages.requestAnalysis.summary.noEnjeux')}
                </p>
              )}
            </div>

            {/* Contexte légal */}
            {legalContext.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                  {t('pages.requestAnalysis.summary.legalContext')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {legalContext.map((context) => (
                    <Badge key={context} variant="warning" className="text-xs">
                      {getLegalContextLabel(context)}
                    </Badge>
                  ))}
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

        {/* Main zone: Recommandations */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="lg:col-span-6 rounded-xl border border-border bg-background shadow-soft overflow-hidden"
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

        {/* Right zone: Actions (placeholder) */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-3 rounded-xl border border-border bg-background shadow-soft overflow-hidden"
        >
          {/* Section header */}
          <div className="bg-background-secondary/50 border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-background-tertiary p-1.5">
                <UserCheck className="h-3.5 w-3.5 text-foreground-secondary" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">
                {t('pages.requestAnalysis.actions.title')}
              </h2>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Action buttons (disabled stubs) */}
            <div className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled
              >
                <Lightbulb className="h-4 w-4 mr-2" />
                {t('pages.requestAnalysis.actions.propose')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled
              >
                <UserCheck className="h-4 w-4 mr-2" />
                {t('pages.requestAnalysis.actions.assign')}
              </Button>
            </div>

            {/* Helper message */}
            <div className="rounded-lg border border-border bg-background-secondary/50 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-foreground-muted shrink-0 mt-0.5" />
                <p className="text-xs text-foreground-muted">
                  {t('pages.requestAnalysis.actions.helper')}
                </p>
              </div>
            </div>
          </div>
        </motion.section>
      </div>

      {/* Professional Profile Dialog */}
      <ProfessionalProfileDialog
        professionalId={selectedProfessionalId}
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        onSelect={handleSelectProfessional}
      />
    </div>
  )
}
