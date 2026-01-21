import { useState } from 'react'
import {
  Send,
  Copy,
  XCircle,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Eye,
  ArrowRight,
  Loader2,
  Link as LinkIcon,
  Shield,
} from 'lucide-react'
import {
  formatClinicDateFull,
  formatClinicDateTime,
} from '@/shared/lib/timezone'
import type { ProfessionalWithRelations } from '../types'
import {
  useCreateInvite,
  useRevokeInvite,
  useMarkInviteSent,
  useUpdateProfessionalStatus,
} from '../hooks'
import {
  mapProfessionalToViewModel,
  type OnboardingStepState,
  type FormulaireDisplayStatus,
  FORMULAIRE_STATUS_LABELS,
} from '../mappers'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { useToast } from '@/shared/hooks/use-toast'

interface ProfessionalOnboardingTabProps {
  professional: ProfessionalWithRelations
  onNavigateToTab: (tab: 'portrait' | 'documents') => void
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return formatClinicDateFull(dateStr)
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return formatClinicDateTime(dateStr)
}

/**
 * Generic step status badge for documents and validation steps.
 * For invitation and questionnaire, use the specific display status badges below.
 */
function StepStatusBadge({ status }: { status: OnboardingStepState['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          Complété
        </Badge>
      )
    case 'in_progress':
      return (
        <Badge variant="warning" className="gap-1">
          <Clock className="h-3 w-3" />
          En traitement
        </Badge>
      )
    case 'blocked':
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Bloqué
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="gap-1">
          En attente
        </Badge>
      )
  }
}

/**
 * Badge showing the combined formulaire status (invite + questionnaire).
 */
function FormulaireStatusBadge({ displayKey }: { displayKey: FormulaireDisplayStatus }) {
  const label = FORMULAIRE_STATUS_LABELS[displayKey]

  switch (displayKey) {
    case 'approuve':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'en_revision':
      return (
        <Badge variant="warning" className="gap-1">
          <Clock className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'soumis':
      return (
        <Badge variant="warning" className="gap-1">
          <FileText className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'consulte':
      return (
        <Badge variant="warning" className="gap-1">
          <Eye className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'envoye':
      return (
        <Badge variant="warning" className="gap-1">
          <Send className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'expire':
      return (
        <Badge variant="error" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'revoque':
      return (
        <Badge variant="error" className="gap-1">
          <XCircle className="h-3 w-3" />
          {label}
        </Badge>
      )
    case 'a_envoyer':
    default:
      return (
        <Badge variant="outline" className="gap-1">
          {label}
        </Badge>
      )
  }
}

interface FormulaireStepCardProps {
  professional: ProfessionalWithRelations
  step: OnboardingStepState
  onNavigateToPortrait: () => void
}

function FormulaireStepCard({ professional, step, onNavigateToPortrait }: FormulaireStepCardProps) {
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const { toast } = useToast()

  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()
  const markInviteSent = useMarkInviteSent()

  const invite = professional.latest_invite
  const submission = professional.latest_submission

  // Get the combined display status key from the step
  const formulaireDisplayKey = step.displayStatusKey as FormulaireDisplayStatus | undefined

  const handleCreateInvite = async () => {
    if (!professional.profile?.email) return
    try {
      await createInvite.mutateAsync({
        professional_id: professional.id,
        email: professional.profile.email,
      })
      toast({
        title: 'Lien créé',
        description: 'Le lien du formulaire a été généré avec succès.',
      })
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de créer le lien.',
        variant: 'error',
      })
    }
  }

  const handleCopyLink = async () => {
    if (!invite?.token) return
    const link = `${window.location.origin}/invitation/${invite.token}`
    await navigator.clipboard.writeText(link)
    toast({
      title: 'Lien copié',
      description: 'Le lien du formulaire a été copié dans le presse-papiers.',
    })
  }

  const handleMarkSent = async () => {
    if (!invite?.id) return
    try {
      await markInviteSent.mutateAsync(invite.id)
      toast({
        title: 'Marqué comme envoyé',
        description: 'Le formulaire a été marqué comme envoyé.',
      })
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour le statut.',
        variant: 'error',
      })
    }
  }

  const handleRevokeInvite = async () => {
    if (!invite?.id) return
    try {
      await revokeInvite.mutateAsync(invite.id)
      setShowRevokeDialog(false)
      toast({
        title: 'Lien révoqué',
        description: 'Le lien a été révoqué avec succès.',
      })
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de révoquer le lien.',
        variant: 'error',
      })
    }
  }

  // Determine action availability
  const canCreateLink = !invite || invite.status === 'expired' || invite.status === 'revoked'
  const hasActiveLink = invite && ['pending', 'opened', 'completed'].includes(invite.status)
  const canRevoke = hasActiveLink && formulaireDisplayKey !== 'approuve'

  return (
    <Card className={step.status === 'completed' ? 'border-sage-200 bg-sage-50/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                step.status === 'completed'
                  ? 'bg-sage-100 text-sage-600'
                  : step.status === 'in_progress'
                    ? 'bg-honey-100 text-honey-600'
                    : 'bg-background-secondary text-foreground-muted'
              }`}
            >
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{step.labelFr}</CardTitle>
              <CardDescription className="mt-0.5">
                {step.descriptionFr}
              </CardDescription>
            </div>
          </div>
          {/* Combined formulaire status badge */}
          {formulaireDisplayKey ? (
            <FormulaireStatusBadge displayKey={formulaireDisplayKey} />
          ) : (
            <StepStatusBadge status={step.status} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Timeline: key dates from invite + submission */}
        {(invite || submission) && (
          <div className="mb-4 space-y-2 rounded-lg bg-background-secondary/50 p-3 text-sm">
            {invite?.sent_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Envoyé le</span>
                <span>{formatDateTime(invite.sent_at)}</span>
              </div>
            )}
            {invite?.opened_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Consulté le</span>
                <span>{formatDateTime(invite.opened_at)}</span>
              </div>
            )}
            {submission?.submitted_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Soumis le</span>
                <span>{formatDateTime(submission.submitted_at)}</span>
              </div>
            )}
            {submission?.reviewed_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Révisé le</span>
                <span>{formatDateTime(submission.reviewed_at)}</span>
              </div>
            )}
            {invite && !submission?.submitted_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Expire le</span>
                <span>{formatDate(invite.expires_at)}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {canCreateLink && (
            <Button
              onClick={handleCreateInvite}
              disabled={createInvite.isPending}
            >
              {createInvite.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {invite ? 'Créer un nouveau lien' : 'Créer le lien'}
            </Button>
          )}

          {hasActiveLink && (
            <>
              {/* Copy link */}
              <Button onClick={handleCopyLink}>
                <Copy className="h-4 w-4" />
                Copier le lien
              </Button>

              {/* View link details */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowLinkDialog(true)}
                title="Voir le lien"
              >
                <LinkIcon className="h-4 w-4" />
              </Button>

              {/* Mark as sent (only if not already sent) */}
              {!invite?.sent_at && (
                <Button
                  variant="outline"
                  onClick={handleMarkSent}
                  disabled={markInviteSent.isPending}
                >
                  {markInviteSent.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Marquer envoyé
                </Button>
              )}
            </>
          )}

          {/* View submission (if exists) */}
          {submission && (
            <Button variant="secondary" onClick={onNavigateToPortrait}>
              <Eye className="h-4 w-4" />
              Voir la soumission
            </Button>
          )}

          {/* Revoke (only if link is active and not yet approved) */}
          {canRevoke && (
            <Button
              variant="ghost"
              onClick={() => setShowRevokeDialog(true)}
              className="text-wine-600 hover:bg-wine-50 hover:text-wine-700"
            >
              <XCircle className="h-4 w-4" />
              Révoquer
            </Button>
          )}
        </div>

        {/* Empty state message */}
        {!invite && !submission && (
          <p className="text-sm text-foreground-muted">
            Créez un lien pour permettre au professionnel de compléter son formulaire d'intégration.
          </p>
        )}

        {/* Link dialog */}
        <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Lien du formulaire</DialogTitle>
              <DialogDescription>
                Partagez ce lien avec le professionnel pour qu'il puisse compléter son formulaire.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-background-secondary p-3">
                <code className="flex-1 break-all text-sm">
                  {invite?.token
                    ? `${window.location.origin}/invitation/${invite.token}`
                    : '—'}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-foreground-muted">
                Ce lien expire le {formatDate(invite?.expires_at)}.
                Après cette date, un nouveau lien devra être créé.
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Revoke confirmation dialog */}
        <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Révoquer le lien ?</DialogTitle>
              <DialogDescription>
                Le lien actuel sera désactivé et le professionnel ne pourra plus l'utiliser.
                Vous pourrez créer un nouveau lien par la suite.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowRevokeDialog(false)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={handleRevokeInvite}
                disabled={revokeInvite.isPending}
              >
                {revokeInvite.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Révoquer'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

interface DocumentsStepCardProps {
  professional: ProfessionalWithRelations
  step: OnboardingStepState
  onNavigateToDocuments: () => void
  missingDocs: number
}

function DocumentsStepCard({
  step,
  onNavigateToDocuments,
  missingDocs,
}: DocumentsStepCardProps) {
  return (
    <Card className={step.status === 'completed' ? 'border-sage-200 bg-sage-50/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                step.status === 'completed'
                  ? 'bg-sage-100 text-sage-600'
                  : step.status === 'in_progress'
                    ? 'bg-honey-100 text-honey-600'
                    : 'bg-background-secondary text-foreground-muted'
              }`}
            >
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{step.labelFr}</CardTitle>
              <CardDescription className="mt-0.5">
                {step.descriptionFr}
              </CardDescription>
            </div>
          </div>
          <StepStatusBadge status={step.status} />
        </div>
      </CardHeader>
      <CardContent>
        {missingDocs > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-honey-50 p-3 text-sm text-honey-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {missingDocs} document(s) requis manquant(s) ou expiré(s).
              Les documents requis incluent: photo, assurance, consentement droit à l'image et contrat de service.
            </span>
          </div>
        )}

        <Button variant="outline" onClick={onNavigateToDocuments}>
          <ArrowRight className="h-4 w-4" />
          Gérer les documents
        </Button>
      </CardContent>
    </Card>
  )
}

interface ActivationStepCardProps {
  professional: ProfessionalWithRelations
  step: OnboardingStepState
  viewModel: ReturnType<typeof mapProfessionalToViewModel>
}

function ActivationStepCard({ professional, step, viewModel }: ActivationStepCardProps) {
  const { toast } = useToast()
  const updateStatus = useUpdateProfessionalStatus()

  const handleActivate = () => {
    updateStatus.mutate(
      { id: professional.id, input: { status: 'active' } },
      {
        onSuccess: () => {
          toast({
            title: 'Professionnel activé',
            description: 'Le professionnel est maintenant actif sur la plateforme.',
          })
        },
        onError: () => {
          toast({
            title: 'Erreur',
            description: "Une erreur est survenue lors de l'activation.",
            variant: 'error',
          })
        },
      }
    )
  }

  const canActivate = viewModel.onboarding.canActivate
  const hasBlockers = viewModel.onboarding.activationBlockers.length > 0

  // Determine actual display status - avoid contradictory states
  // If there are blockers, never show "completed" even if step.status says so
  const displayStatus = hasBlockers && step.status === 'completed' ? 'pending' : step.status

  return (
    <Card className={displayStatus === 'completed' ? 'border-sage-200 bg-sage-50/30' : canActivate ? 'border-sage-200' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                displayStatus === 'completed'
                  ? 'bg-sage-100 text-sage-600'
                  : canActivate
                    ? 'bg-sage-100 text-sage-600'
                    : 'bg-background-secondary text-foreground-muted'
              }`}
            >
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{step.labelFr}</CardTitle>
              <CardDescription className="mt-0.5">
                {step.descriptionFr}
              </CardDescription>
            </div>
          </div>
          {displayStatus === 'completed' ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Activé
            </Badge>
          ) : canActivate ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Prêt à activer
            </Badge>
          ) : (
            <StepStatusBadge status={displayStatus} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {hasBlockers && displayStatus !== 'completed' && (
          <div className="mb-4 space-y-2 rounded-lg bg-background-secondary/50 p-3 text-sm">
            <p className="font-medium text-foreground">
              À compléter avant activation :
            </p>
            <ul className="space-y-1.5">
              {viewModel.onboarding.activationBlockers.map((blocker, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-foreground-muted"
                >
                  <Clock className="h-3.5 w-3.5 text-honey-500" />
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        )}

        {displayStatus === 'completed' ? (
          <div className="flex items-center gap-2 text-sm text-sage-700">
            <CheckCircle className="h-4 w-4" />
            Le professionnel est activé et visible sur la plateforme.
          </div>
        ) : canActivate ? (
          <Button onClick={handleActivate} disabled={updateStatus.isPending}>
            {updateStatus.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {updateStatus.isPending ? 'Activation...' : 'Activer le professionnel'}
          </Button>
        ) : (
          <p className="text-sm text-foreground-muted">
            Une fois les étapes ci-dessus complétées, vous pourrez activer ce professionnel.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ProfessionalOnboardingTab({
  professional,
  onNavigateToTab,
}: ProfessionalOnboardingTabProps) {
  const viewModel = mapProfessionalToViewModel(professional)
  const { steps } = viewModel.onboarding

  const formulaireStep = steps.find(s => s.step === 'formulaire')!
  const documentsStep = steps.find(s => s.step === 'documents')!
  const activationStep = steps.find(s => s.step === 'activation')!

  const missingDocs = viewModel.requiredDocuments.filter(
    d => d.status === 'missing' || d.status === 'expired'
  ).length

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                Progression de l'intégration
              </h3>
              <p className="text-sm text-foreground-muted">
                {viewModel.onboarding.isComplete
                  ? 'Toutes les étapes sont complétées'
                  : `${steps.filter(s => s.status === 'completed').length} sur ${steps.length} étapes complétées`}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-background-tertiary">
                <div
                  className="h-full rounded-full bg-sage-500 transition-all duration-500"
                  style={{ width: `${viewModel.onboarding.completionPercentage}%` }}
                />
              </div>
              <span className="text-sm font-medium text-foreground">
                {viewModel.onboarding.completionPercentage}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Cards - 3 steps: Formulaire, Documents, Activation */}
      <div className="space-y-4">
        <FormulaireStepCard
          professional={professional}
          step={formulaireStep}
          onNavigateToPortrait={() => onNavigateToTab('portrait')}
        />

        <DocumentsStepCard
          professional={professional}
          step={documentsStep}
          onNavigateToDocuments={() => onNavigateToTab('documents')}
          missingDocs={missingDocs}
        />

        <ActivationStepCard
          professional={professional}
          step={activationStep}
          viewModel={viewModel}
        />
      </div>

      {/* Help text */}
      <div className="rounded-lg border border-border bg-background-secondary/30 p-4 text-sm text-foreground-muted">
        <p className="font-medium text-foreground">Processus d'intégration</p>
        <p className="mt-1">
          L'intégration d'un professionnel se fait en trois étapes: envoi et complétion du formulaire,
          téléversement des documents requis, et activation finale.
        </p>
      </div>
    </div>
  )
}
