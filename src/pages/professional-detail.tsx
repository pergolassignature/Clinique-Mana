import { useState } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Send,
  XCircle,
  Power,
  PowerOff,
  FileText,
  Clock,
  User,
  Briefcase,
  History,
} from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import {
  useProfessional,
  useCreateInvite,
  useRevokeInvite,
  useUpdateProfessionalStatus,
} from '@/professionals'
import type { ProfessionalDetailTab, ProfessionalStatus } from '@/professionals'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'

// Tab components (will be expanded in later phases)
import { ProfessionalProfileTab } from '@/professionals/components/profile-tab'
import { ProfessionalPortraitTab } from '@/professionals/components/portrait-tab'
import { ProfessionalDocumentsTab } from '@/professionals/components/documents-tab'
import { ProfessionalFicheTab } from '@/professionals/components/fiche-tab'
import { ProfessionalHistoryTab } from '@/professionals/components/history-tab'

const tabs: Array<{
  id: ProfessionalDetailTab
  label: string
  icon: typeof User
}> = [
  { id: 'profil', label: 'professionals.detail.tabs.profil', icon: User },
  { id: 'portrait', label: 'professionals.detail.tabs.portrait', icon: Briefcase },
  { id: 'documents', label: 'professionals.detail.tabs.documents', icon: FileText },
  { id: 'fiche', label: 'professionals.detail.tabs.fiche', icon: FileText },
  { id: 'historique', label: 'professionals.detail.tabs.historique', icon: History },
]

function getStatusBadgeVariant(status: ProfessionalStatus): 'default' | 'secondary' | 'outline' | 'error' {
  switch (status) {
    case 'active':
      return 'default'
    case 'invited':
      return 'secondary'
    case 'pending':
      return 'outline'
    case 'inactive':
      return 'error'
    default:
      return 'outline'
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-1.5 h-4 w-32" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  )
}

export function ProfessionalDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ProfessionalDetailTab>('profil')

  const { data: professional, isLoading, error } = useProfessional(id)
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()
  const updateStatus = useUpdateProfessionalStatus()

  const handleSendInvite = async () => {
    if (!professional?.profile?.email) return
    try {
      await createInvite.mutateAsync({
        professional_id: professional.id,
        email: professional.profile.email,
      })
    } catch (err) {
      console.error('Failed to create invite:', err)
    }
  }

  const handleRevokeInvite = async () => {
    if (!professional?.latest_invite?.id) return
    try {
      await revokeInvite.mutateAsync(professional.latest_invite.id)
    } catch (err) {
      console.error('Failed to revoke invite:', err)
    }
  }

  const handleToggleStatus = async () => {
    if (!professional) return
    const newStatus: ProfessionalStatus =
      professional.status === 'active' ? 'inactive' : 'active'
    try {
      await updateStatus.mutateAsync({
        id: professional.id,
        input: { status: newStatus },
      })
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const canSendInvite =
    professional?.status === 'pending' ||
    (professional?.status === 'invited' &&
      (!professional.latest_invite || professional.latest_invite.status === 'expired'))

  const canRevokeInvite =
    professional?.latest_invite &&
    ['pending', 'opened'].includes(professional.latest_invite.status)

  const canToggleStatus =
    professional?.status === 'active' || professional?.status === 'inactive'

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-foreground-muted">{t('common.error')}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate({ to: '/professionnels' })}
        >
          {t('professionals.detail.backLink')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/professionnels"
        className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('professionals.detail.backLink')}
      </Link>

      {/* Header */}
      {isLoading ? (
        <HeaderSkeleton />
      ) : professional ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Profile info */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-600">
              <span className="text-lg font-semibold">
                {professional.profile?.display_name
                  ?.split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?'}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">
                  {professional.profile?.display_name || '—'}
                </h1>
                <Badge variant={getStatusBadgeVariant(professional.status)}>
                  {t(
                    `professionals.list.status.${professional.status}` as Parameters<
                      typeof t
                    >[0]
                  )}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-foreground-muted">
                {professional.profile?.email}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {canSendInvite && (
              <Button
                onClick={handleSendInvite}
                disabled={createInvite.isPending}
              >
                <Send className="h-4 w-4" />
                {professional.status === 'pending'
                  ? t('professionals.detail.actions.sendInvite')
                  : t('professionals.detail.actions.resendInvite')}
              </Button>
            )}

            {canRevokeInvite && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={handleRevokeInvite}
                    disabled={revokeInvite.isPending}
                  >
                    <XCircle className="h-4 w-4" />
                    {t('professionals.detail.actions.revokeInvite')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Annuler l'invitation en cours
                </TooltipContent>
              </Tooltip>
            )}

            {canToggleStatus && (
              <Button
                variant={professional.status === 'active' ? 'outline' : 'default'}
                onClick={handleToggleStatus}
                disabled={updateStatus.isPending}
              >
                {professional.status === 'active' ? (
                  <>
                    <PowerOff className="h-4 w-4" />
                    {t('professionals.detail.actions.deactivate')}
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    {t('professionals.detail.actions.activate')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* Invite status card */}
      {professional?.latest_invite && (
        <Card className="border-honey-200 bg-honey-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-honey-600" />
              <CardTitle className="text-base">
                {t('professionals.detail.invite.title')}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-foreground-muted">
                  {t('professionals.detail.invite.status')}:
                </span>{' '}
                <span className="font-medium capitalize">
                  {professional.latest_invite.status}
                </span>
              </div>
              {professional.latest_invite.sent_at && (
                <div>
                  <span className="text-foreground-muted">
                    {t('professionals.detail.invite.sentAt')}:
                  </span>{' '}
                  <span className="font-medium">
                    {formatDate(professional.latest_invite.sent_at)}
                  </span>
                </div>
              )}
              {professional.latest_invite.opened_at && (
                <div>
                  <span className="text-foreground-muted">
                    {t('professionals.detail.invite.openedAt')}:
                  </span>{' '}
                  <span className="font-medium">
                    {formatDate(professional.latest_invite.opened_at)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-foreground-muted">
                  {t('professionals.detail.invite.expiresAt')}:
                </span>{' '}
                <span className="font-medium">
                  {formatDate(professional.latest_invite.expires_at)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-sage-600 text-sage-600'
                    : 'border-transparent text-foreground-muted hover:border-border hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {t(tab.label as Parameters<typeof t>[0])}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          ) : professional ? (
            <>
              {activeTab === 'profil' && (
                <ProfessionalProfileTab professional={professional} />
              )}
              {activeTab === 'portrait' && (
                <ProfessionalPortraitTab professional={professional} />
              )}
              {activeTab === 'documents' && (
                <ProfessionalDocumentsTab professional={professional} />
              )}
              {activeTab === 'fiche' && (
                <ProfessionalFicheTab professional={professional} />
              )}
              {activeTab === 'historique' && (
                <ProfessionalHistoryTab professional={professional} />
              )}
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
