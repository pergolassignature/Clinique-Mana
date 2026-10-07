import { useState, useCallback } from 'react'
import { pdf } from '@react-pdf/renderer'
import {
  LayoutDashboard,
  AlertCircle,
  FileText,
  Send,
  Copy,
  Eye,
  ArrowRight,
  Loader2,
  Power,
  PowerOff,
  Download,
  RefreshCw,
} from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations, ProfessionalDetailTab } from '../types'
import { mapProfessionalToViewModel, mapOnboardingState, type ContractStatus } from '../mappers'
import { useServiceContractStatus } from '@/document-templates/hooks'
import {
  useCreateInvite,
  useUpdateProfessionalStatus,
} from '../hooks'
import { StatusIndicator, type StatusIndicatorStatus } from './status-indicator'
import { FichePdfDocument } from './fiche-pdf-document'
import { prepareFicheData, loadLogoAsBase64 } from '../utils/fiche-data'
import { UpdateRequestModal } from './update-request-modal'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ProfessionalApercuTabProps {
  professional: ProfessionalWithRelations
  onNavigateToTab: (tab: ProfessionalDetailTab) => void
}

interface AlertItem {
  id: string
  type: 'warning' | 'error' | 'info'
  title: string
  description: string
  action: {
    label: string
    tab: ProfessionalDetailTab
  }
}

export function ProfessionalApercuTab({ professional, onNavigateToTab }: ProfessionalApercuTabProps) {
  const { toast } = useToast()
  const viewModel = mapProfessionalToViewModel(professional)

  // Get contract status to include in onboarding calculations
  const { isSigned: isContractSigned, instance: contractInstance } = useServiceContractStatus(professional.id)
  const contractStatus: ContractStatus = isContractSigned ? 'signed' : contractInstance ? 'pending' : 'missing'

  // Recalculate onboarding with contract status
  const onboarding = mapOnboardingState(professional, { contractStatus })

  const createInvite = useCreateInvite()
  const updateStatus = useUpdateProfessionalStatus()

  // Build alerts array based on current state
  const alerts: AlertItem[] = []

  // Missing portrait content
  if (!viewModel.bio && !viewModel.approach) {
    alerts.push({
      id: 'missing-portrait',
      type: 'warning',
      title: t('professionals.detail.apercu.alerts.missingPortrait.title'),
      description: t('professionals.detail.apercu.alerts.missingPortrait.description'),
      action: { label: t('professionals.detail.apercu.alerts.missingPortrait.action'), tab: 'profil-public' },
    })
  }

  // Missing specialties
  if (Object.keys(viewModel.specialtiesByCategory).length === 0) {
    alerts.push({
      id: 'missing-specialties',
      type: 'warning',
      title: t('professionals.detail.apercu.alerts.missingSpecialties.title'),
      description: t('professionals.detail.apercu.alerts.missingSpecialties.description'),
      action: { label: t('professionals.detail.apercu.alerts.missingSpecialties.action'), tab: 'profil-public' },
    })
  }

  // Missing/expired documents
  const missingDocs = viewModel.requiredDocuments.filter(
    d => d.status === 'missing' || d.status === 'expired'
  )
  if (missingDocs.length > 0) {
    alerts.push({
      id: 'missing-docs',
      type: missingDocs.length > 2 ? 'error' : 'warning',
      title: `${missingDocs.length} ${t('professionals.detail.apercu.alerts.missingDocuments.title').replace('{count}', '')}`,
      description: t('professionals.detail.apercu.alerts.missingDocuments.description'),
      action: { label: t('professionals.detail.apercu.alerts.missingDocuments.action'), tab: 'documents' },
    })
  }

  // Determine status indicators
  const hasPortrait = Boolean(viewModel.bio || viewModel.approach)
  const portraitStatus: StatusIndicatorStatus = hasPortrait ? 'complete' : 'pending'

  const docsStatus: StatusIndicatorStatus =
    missingDocs.length === 0 ? 'complete' :
    missingDocs.length > 2 ? 'warning' : 'pending'

  // Invite actions
  const invite = professional.latest_invite
  const canCreateLink = !invite || invite.status === 'expired' || invite.status === 'revoked'
  const hasActiveLink = invite && ['pending', 'opened'].includes(invite.status)
  const hasCompletedInvite = invite?.status === 'completed'

  // Update request modal state
  const [showUpdateRequestModal, setShowUpdateRequestModal] = useState(false)

  const handleCreateInvite = async () => {
    if (!professional.profile?.email) return
    try {
      await createInvite.mutateAsync({
        professional_id: professional.id,
        email: professional.profile.email,
      })
      toast({
        title: t('professionals.detail.apercu.toast.linkCreated.title'),
        description: t('professionals.detail.apercu.toast.linkCreated.description'),
      })
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.apercu.toast.error.createLink'),
        variant: 'error',
      })
    }
  }

  const handleCopyLink = async () => {
    if (!invite?.token) return
    const link = `${window.location.origin}/invitation/${invite.token}`
    await navigator.clipboard.writeText(link)
    toast({
      title: t('professionals.detail.apercu.toast.linkCopied.title'),
      description: t('professionals.detail.apercu.toast.linkCopied.description'),
    })
  }

  const handleToggleStatus = async () => {
    const newStatus = professional.status === 'active' ? 'inactive' : 'active'
    try {
      await updateStatus.mutateAsync({
        id: professional.id,
        input: { status: newStatus },
      })
      toast({
        title: newStatus === 'active'
          ? t('professionals.detail.apercu.toast.statusUpdated.activated.title')
          : t('professionals.detail.apercu.toast.statusUpdated.deactivated.title'),
        description: newStatus === 'active'
          ? t('professionals.detail.apercu.toast.statusUpdated.activated.description')
          : t('professionals.detail.apercu.toast.statusUpdated.deactivated.description'),
      })
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.apercu.toast.error.statusUpdate'),
        variant: 'error',
      })
    }
  }

  const canActivate = onboarding.canActivate
  // Allow status toggle for active/inactive, or for pending when activation is possible
  const canToggleStatus = professional.status === 'active' || professional.status === 'inactive' || (professional.status === 'pending' && canActivate)

  // PDF generation state
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [showProfessionSelector, setShowProfessionSelector] = useState(false)

  // Generate and download PDF for a specific profession
  const generateAndDownloadPdf = useCallback(async (professionTitleKey: string) => {
    setIsGeneratingPdf(true)
    setShowProfessionSelector(false)

    try {
      // Prepare the data for the PDF
      const ficheData = await prepareFicheData({
        professional,
        professionTitleKey,
      })

      // Load the logo
      const logoBase64 = await loadLogoAsBase64()

      // Generate the PDF blob
      const pdfBlob = await pdf(
        <FichePdfDocument data={ficheData} logoBase64={logoBase64} />
      ).toBlob()

      // Create download link
      const url = URL.createObjectURL(pdfBlob)
      const link = document.createElement('a')
      link.href = url

      // Generate filename: Name_Profession.pdf
      const sanitizedName = professional.profile?.display_name
        ?.replace(/[^a-zA-ZÀ-ÿ]/g, '')
        || 'Professionnel'
      const sanitizedProfession = ficheData.professionTitle
        .replace(/[^a-zA-ZÀ-ÿ]/g, '')
      link.download = `${sanitizedName}_${sanitizedProfession}.pdf`

      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        title: 'PDF généré',
        description: `La fiche de ${ficheData.professionTitle} a été téléchargée.`,
      })
    } catch (error) {
      console.error('Failed to generate PDF:', error)
      toast({
        title: 'Erreur',
        description: 'Impossible de générer le PDF. Veuillez réessayer.',
        variant: 'error',
      })
    } finally {
      setIsGeneratingPdf(false)
    }
  }, [professional, toast])

  // Handle download button click
  const handleDownloadPdf = useCallback(() => {
    const professions = professional.professions || []

    if (professions.length === 0) {
      toast({
        title: 'Aucun titre professionnel',
        description: 'Ce professionnel n\'a pas de titre professionnel configuré.',
        variant: 'error',
      })
      return
    }

    if (professions.length === 1 && professions[0]) {
      // Single profession - generate directly
      generateAndDownloadPdf(professions[0].profession_title_key)
    } else if (professions.length > 1) {
      // Multiple professions - show selector
      setShowProfessionSelector(true)
    }
  }, [professional.professions, generateAndDownloadPdf, toast])

  return (
    <>
      <div className="space-y-6">
        {/* Alerts Section */}
        {alerts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">{t('professionals.detail.apercu.toComplete')}</h3>
            {alerts.map((alert) => (
              <Card
                key={alert.id}
                className={
                  alert.type === 'error' ? 'border-wine-200 bg-wine-50/30' :
                  alert.type === 'warning' ? 'border-honey-200 bg-honey-50/30' :
                  'border-sage-200 bg-sage-50/30'
                }
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className={`h-5 w-5 mt-0.5 ${
                        alert.type === 'error' ? 'text-wine-600' :
                        alert.type === 'warning' ? 'text-honey-600' :
                        'text-sage-600'
                      }`} />
                      <div>
                        <p className="font-medium text-foreground">{alert.title}</p>
                        <p className="text-sm text-foreground-muted">{alert.description}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigateToTab(alert.action.tab)}
                    >
                      {alert.action.label}
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Quick Actions - First visible section */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t('professionals.detail.apercu.quickActions.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {/* Download fiche */}
              <Button onClick={handleDownloadPdf} disabled={isGeneratingPdf}>
                {isGeneratingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t('professionals.portrait.fiche.downloadPdf')}
              </Button>

              {/* Invite actions */}
              {canCreateLink && (
                <Button variant="outline" onClick={handleCreateInvite} disabled={createInvite.isPending}>
                  {createInvite.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {invite ? t('professionals.detail.onboarding.actions.newLink') : t('professionals.detail.apercu.quickActions.sendForm')}
                </Button>
              )}

              {hasActiveLink && (
                <Button variant="outline" onClick={handleCopyLink}>
                  <Copy className="h-4 w-4" />
                  {t('professionals.detail.apercu.quickActions.copyLink')}
                </Button>
              )}

              {hasCompletedInvite && (
                <Button variant="outline" onClick={() => setShowUpdateRequestModal(true)}>
                  <RefreshCw className="h-4 w-4" />
                  {t('professionals.detail.apercu.quickActions.requestUpdate')}
                </Button>
              )}

              {professional.latest_submission && (
                <Button variant="outline" onClick={() => onNavigateToTab('profil-public')}>
                  <Eye className="h-4 w-4" />
                  {t('professionals.detail.apercu.quickActions.viewSubmission')}
                </Button>
              )}

              {/* Navigate to documents */}
              <Button variant="outline" onClick={() => onNavigateToTab('documents')}>
                <FileText className="h-4 w-4" />
                {t('professionals.detail.apercu.quickActions.manageDocuments')}
              </Button>

              {/* Activate/Deactivate */}
              {canToggleStatus && (
                <Button
                  variant={professional.status === 'active' ? 'outline' : 'default'}
                  onClick={handleToggleStatus}
                  disabled={updateStatus.isPending || (!canActivate && professional.status !== 'active')}
                >
                  {updateStatus.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : professional.status === 'active' ? (
                    <>
                      <PowerOff className="h-4 w-4" />
                      {t('professionals.detail.apercu.quickActions.deactivate')}
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4" />
                      {t('professionals.detail.apercu.quickActions.activate')}
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Overview */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-sage-600" />
              <CardTitle className="text-base">{t('professionals.detail.apercu.indicators.title')}</CardTitle>
            </div>
            <CardDescription>{t('professionals.detail.apercu.indicators.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusIndicator
              label={t('professionals.detail.apercu.indicators.portrait.label')}
              status={portraitStatus}
              description={
                hasPortrait
                  ? t('professionals.detail.apercu.indicators.portrait.complete')
                  : t('professionals.detail.apercu.indicators.portrait.pending')
              }
            />
            <StatusIndicator
              label={t('professionals.detail.apercu.indicators.documents.label')}
              status={docsStatus}
              description={
                docsStatus === 'complete'
                  ? t('professionals.detail.apercu.indicators.documents.complete')
                  : `${missingDocs.length} ${t('professionals.detail.apercu.indicators.documents.pending').replace('{count}', '')}`
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Profession Selector Dialog (for professionals with multiple professions) */}
      <Dialog open={showProfessionSelector} onOpenChange={setShowProfessionSelector}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choisir le titre professionnel</DialogTitle>
            <DialogDescription>
              Ce professionnel a plusieurs titres. Sélectionnez celui pour lequel vous souhaitez générer la fiche.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {(professional.professions || []).map((profession) => (
              <Button
                key={profession.profession_title_key}
                variant="outline"
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => generateAndDownloadPdf(profession.profession_title_key)}
                disabled={isGeneratingPdf}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {profession.profession_title?.label_fr || profession.profession_title_key}
                  </span>
                  {profession.license_number && (
                    <span className="text-xs text-foreground-muted">
                      Permis: {profession.license_number}
                    </span>
                  )}
                </div>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProfessionSelector(false)}>
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Request Modal - conditionally rendered to reset state on close */}
      {showUpdateRequestModal && (
        <UpdateRequestModal
          open={showUpdateRequestModal}
          onClose={() => setShowUpdateRequestModal(false)}
          professional={professional}
        />
      )}
    </>
  )
}
