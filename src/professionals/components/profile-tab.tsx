import { Mail, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations } from '../types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'

interface ProfessionalProfileTabProps {
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

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ProfessionalProfileTab({ professional }: ProfessionalProfileTabProps) {
  const profile = professional.profile
  const latestInvite = professional.latest_invite
  const latestSubmission = professional.latest_submission

  const inviteStatusIcon = () => {
    if (!latestInvite) return null
    switch (latestInvite.status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-sage-500" />
      case 'expired':
      case 'revoked':
        return <AlertCircle className="h-4 w-4 text-wine-500" />
      default:
        return <Clock className="h-4 w-4 text-honey-500" />
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Profile Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('professionals.detail.profile.title')}
          </CardTitle>
          <CardDescription>
            Informations de base du profil utilisateur
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.displayName')}
              </p>
              <p className="mt-1 text-sm">{profile?.display_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.email')}
              </p>
              <p className="mt-1 text-sm">{profile?.email || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.status')}
              </p>
              <div className="mt-1">
                <Badge
                  variant={profile?.status === 'active' ? 'default' : 'error'}
                >
                  {profile?.status === 'active' ? 'Actif' : 'Désactivé'}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-muted">
                {t('professionals.detail.profile.createdAt')}
              </p>
              <p className="mt-1 text-sm">{formatDate(professional.created_at)}</p>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-foreground-muted">
              {t('professionals.detail.profile.lastUpdated')}
            </p>
            <p className="mt-1 text-sm">{formatDateTime(professional.updated_at)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Invite Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('professionals.detail.invite.title')}
          </CardTitle>
          <CardDescription>
            État de l'invitation d'onboarding
          </CardDescription>
        </CardHeader>
        <CardContent>
          {latestInvite ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {inviteStatusIcon()}
                <span className="text-sm font-medium capitalize">
                  {latestInvite.status}
                </span>
              </div>

              <div className="grid gap-3 text-sm">
                {latestInvite.sent_at && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">
                      {t('professionals.detail.invite.sentAt')}
                    </span>
                    <span>{formatDateTime(latestInvite.sent_at)}</span>
                  </div>
                )}
                {latestInvite.opened_at && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">
                      {t('professionals.detail.invite.openedAt')}
                    </span>
                    <span>{formatDateTime(latestInvite.opened_at)}</span>
                  </div>
                )}
                {latestInvite.completed_at && (
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">
                      {t('professionals.detail.invite.completedAt')}
                    </span>
                    <span>{formatDateTime(latestInvite.completed_at)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-foreground-muted">
                    {t('professionals.detail.invite.expiresAt')}
                  </span>
                  <span>{formatDateTime(latestInvite.expires_at)}</span>
                </div>
              </div>

              {latestInvite.status === 'pending' && (
                <div className="rounded-lg bg-honey-50 p-3 text-sm text-honey-700">
                  <p className="font-medium">
                    {t('professionals.detail.invite.pendingCompletion')}
                  </p>
                  <p className="mt-1 text-honey-600">
                    {t('professionals.detail.invite.waitingResponse')}
                  </p>
                </div>
              )}

              {latestInvite.status === 'opened' && (
                <div className="rounded-lg bg-sage-50 p-3 text-sm text-sage-700">
                  <p className="font-medium">
                    {t('professionals.detail.invite.opened')}
                  </p>
                  <p className="mt-1 text-sage-600">
                    {t('professionals.detail.invite.openedMessage')}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center">
              <Mail className="mx-auto h-8 w-8 text-foreground-muted" />
              <p className="mt-2 text-sm font-medium">
                {t('professionals.detail.invite.noInvite')}
              </p>
              <p className="mt-1 text-xs text-foreground-muted">
                {t('professionals.detail.invite.sendFirst')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Questionnaire Status */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">
            {t('professionals.detail.questionnaire.title')}
          </CardTitle>
          <CardDescription>
            État du questionnaire d'onboarding
          </CardDescription>
        </CardHeader>
        <CardContent>
          {latestSubmission ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {latestSubmission.status === 'approved' ? (
                    <CheckCircle className="h-4 w-4 text-sage-500" />
                  ) : latestSubmission.status === 'submitted' ? (
                    <Clock className="h-4 w-4 text-honey-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-foreground-muted" />
                  )}
                  <span className="text-sm font-medium capitalize">
                    {latestSubmission.status}
                  </span>
                </div>
                {latestSubmission.submitted_at && (
                  <span className="text-sm text-foreground-muted">
                    {t('professionals.detail.questionnaire.submittedAt')}:{' '}
                    {formatDateTime(latestSubmission.submitted_at)}
                  </span>
                )}
              </div>

              {latestSubmission.reviewed_at && (
                <div className="border-t border-border pt-4">
                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-foreground-muted">
                        {t('professionals.detail.questionnaire.reviewedAt')}
                      </span>
                      <span>{formatDateTime(latestSubmission.reviewed_at)}</span>
                    </div>
                    {latestSubmission.review_notes && (
                      <div>
                        <p className="text-foreground-muted">
                          {t('professionals.detail.questionnaire.reviewNotes')}:
                        </p>
                        <p className="mt-1 rounded-lg bg-background-secondary p-3">
                          {latestSubmission.review_notes}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {latestSubmission.status === 'submitted' && (
                <div className="rounded-lg bg-honey-50 p-3 text-sm text-honey-700">
                  <p className="font-medium">
                    {t('professionals.detail.questionnaire.pendingReview')}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-foreground-muted" />
              <p className="mt-2 text-sm font-medium">
                {t('professionals.detail.questionnaire.noSubmission')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
