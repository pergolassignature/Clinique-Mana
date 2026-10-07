import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Calendar,
  RefreshCw,
  Link2Off,
  AlertCircle,
  CheckCircle,
  Loader2,
  ExternalLink,
  Info,
  Clock,
} from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort, formatClinicTime } from '@/shared/lib/timezone'
import type { ProfessionalWithRelations } from '../types'
import {
  useCalendarConnection,
  useConnectGoogleCalendar,
  useSyncCalendar,
  useDisconnectCalendar,
} from '../hooks'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { EmptyState } from '@/shared/components/empty-state'
import { useToast } from '@/shared/hooks/use-toast'
import { Link } from '@tanstack/react-router'

interface ProfessionalCalendarTabProps {
  professional: ProfessionalWithRelations
}

// Google icon SVG
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {t('professionals.detail.calendar.status.synced')}
        </Badge>
      )
    case 'expired':
    case 'revoked':
      return (
        <Badge variant="warning" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {t('professionals.detail.calendar.status.reconnect')}
        </Badge>
      )
    case 'error':
      return (
        <Badge variant="error" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {t('professionals.detail.calendar.status.error')}
        </Badge>
      )
    default:
      return null
  }
}

export function ProfessionalCalendarTab({ professional }: ProfessionalCalendarTabProps) {
  const { toast } = useToast()
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)

  // Queries and mutations
  const { data: connection, isLoading } = useCalendarConnection(professional.id)
  const connectGoogle = useConnectGoogleCalendar()
  const syncCalendar = useSyncCalendar()
  const disconnectCalendar = useDisconnectCalendar()

  const handleConnect = () => {
    connectGoogle.mutate(professional.id)
  }

  const handleSync = () => {
    syncCalendar.mutate(professional.id, {
      onSuccess: (data) => {
        toast({
          title: t('professionals.detail.calendar.toast.synced.title'),
          description: `${data.busyBlocksCount} blocs importés.`,
        })
      },
      onError: () => {
        toast({
          title: t('professionals.detail.calendar.toast.error.title'),
          description: t('professionals.detail.calendar.toast.error.description'),
          variant: 'error',
        })
      },
    })
  }

  const handleDisconnect = () => {
    disconnectCalendar.mutate(professional.id, {
      onSuccess: () => {
        setShowDisconnectDialog(false)
        toast({
          title: t('professionals.detail.calendar.toast.disconnected.title'),
          description: t('professionals.detail.calendar.toast.disconnected.description'),
        })
      },
      onError: () => {
        toast({
          title: t('professionals.detail.calendar.toast.error.title'),
          description: t('professionals.detail.calendar.toast.error.description'),
          variant: 'error',
        })
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-sage-500" />
      </div>
    )
  }

  // Disconnected state
  if (!connection) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('professionals.detail.calendar.title')}</CardTitle>
            <CardDescription>
              {t('professionals.detail.calendar.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={<Calendar className="h-8 w-8" />}
              title={t('professionals.detail.calendar.empty.title')}
              description={t('professionals.detail.calendar.empty.description')}
              action={
                <Button
                  onClick={handleConnect}
                  disabled={connectGoogle.isPending}
                  className="gap-2"
                >
                  {connectGoogle.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GoogleIcon className="h-4 w-4" />
                  )}
                  {t('professionals.detail.calendar.connect.google')}
                </Button>
              }
            />

            {/* Privacy notice */}
            <div className="mt-6 flex items-start gap-3 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{t('professionals.detail.calendar.privacy')}</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // Connected state
  const needsReconnect = connection.status === 'expired' || connection.status === 'revoked'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('professionals.detail.calendar.title')}</CardTitle>
          <CardDescription>Google Calendar connecté</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection info */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-background-secondary/50 p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
                <GoogleIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="font-medium text-foreground">{connection.provider_email}</p>
                <div className="mt-1 flex items-center gap-3 text-sm text-foreground-secondary">
                  <StatusBadge status={connection.status} />
                  {connection.last_synced_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Dernière synchronisation : {formatClinicDateShort(connection.last_synced_at)} à {formatClinicTime(connection.last_synced_at)}
                    </span>
                  )}
                </div>
                {connection.last_error && connection.status === 'error' && (
                  <p className="mt-1 text-sm text-destructive">{connection.last_error}</p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {needsReconnect ? (
              <Button
                onClick={handleConnect}
                disabled={connectGoogle.isPending}
                className="gap-2"
              >
                {connectGoogle.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reconnecter
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={syncCalendar.isPending}
                className="gap-2"
              >
                {syncCalendar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('professionals.detail.calendar.actions.syncNow')}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => setShowDisconnectDialog(true)}
              className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Link2Off className="h-4 w-4" />
              {t('professionals.detail.calendar.actions.disconnect')}
            </Button>
          </div>

          {/* Link to availability calendar */}
          <div className="flex items-center gap-2 rounded-lg border border-sage-200 bg-sage-50 p-4">
            <Calendar className="h-5 w-5 text-sage-600" />
            <p className="flex-1 text-sm text-sage-700">
              Les blocs importés s'affichent dans le calendrier de disponibilités.
            </p>
            <Link to="/disponibilites" className="inline-flex items-center gap-1 text-sm font-medium text-sage-700 hover:text-sage-800">
              {t('professionals.detail.calendar.viewCalendar')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect confirmation dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('professionals.detail.calendar.disconnect.title')}</DialogTitle>
            <DialogDescription>
              {t('professionals.detail.calendar.disconnect.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectDialog(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnectCalendar.isPending}
              className="gap-2"
            >
              {disconnectCalendar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('professionals.detail.calendar.actions.disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
