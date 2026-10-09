import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { roleLabel } from '@/core/access/roles'
import { emailStatusLabel } from '@/core/email/status'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { initialsOf } from '@/shared/lib/format'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { Button, buttonVariants } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { TableCell, TableRow } from '@/shared/ui/table'
import type { StaffInvitation } from '../api'
import { useResendInvitation, useRevokeInvitation } from '../hooks'

interface PendingInvitationRowsProps {
  invitations: StaffInvitation[]
  /** users.manage: « Renvoyer » and « Révoquer » in the actions column. */
  canManage: boolean
  /**
   * Where focus goes once « Révoquer » is confirmed (the « Inviter » button): the row, and the
   * button that opened the confirmation, are about to go.
   */
  onRevokeConfirmed?: () => void
}

/** The email's outcome as the row's badge reads it. */
type Delivery = 'sent' | 'notDelivered' | 'unknown'

/**
 * A bounce, a failure or no email logged reads « Courriel non remis »; a failure whose outcome is
 * unknown (`provider_unavailable`: the provider may have taken it) reads « Résultat inconnu », as
 * in the send log (`emailStatusLabel`). Anything else is on its way or delivered.
 */
function deliveryOf(invitation: StaffInvitation): Delivery {
  const status = invitation.last_email_status
  if (status === null || status === 'bounced') return 'notDelivered'
  if (status !== 'failed') return 'sent'
  return invitation.last_email_error_code === 'provider_unavailable' ? 'unknown' : 'notDelivered'
}

function StatusBadge({ invitation }: { invitation: StaffInvitation }) {
  if (invitation.is_expired) return <Badge variant="warning">{t('settings.users.invitations.status.expired')}</Badge>
  const delivery = deliveryOf(invitation)
  if (delivery === 'sent') return <Badge variant="info">{t('settings.users.invitations.status.sent')}</Badge>
  const label =
    delivery === 'unknown'
      ? emailStatusLabel('failed', invitation.last_email_error_code).label
      : t('settings.users.invitations.status.notDelivered')
  return <Badge variant="warning">{label}</Badge>
}

/**
 * The pending invitations, as rows of the users table (same columns): the name (with the address
 * under it on phones), the address, the role, « Invitation envoyée », « Courriel non remis » or
 * « Expirée » with the last email's status (`emailStatusLabel`: « Adresse introuvable » for a
 * bounce), and in the activity column, the expiry and who sent it. With users.manage, a last cell
 * holds « Renvoyer » (a new link; the previous one stops working) and « Révoquer » (after a
 * confirmation), each named with the person for screen readers; a row's actions are inactive while
 * its revocation runs. Rows do not open a sheet.
 */
export function PendingInvitationRows({ invitations, canManage, onRevokeConfirmed }: PendingInvitationRowsProps) {
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  // The invitation stays while the dialog plays its closing animation; `confirmOpen` drives it.
  const [revoking, setRevoking] = useState<StaffInvitation | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmed = useRef(false)
  // The « Révoquer » that opened the dialog (it has no Radix trigger to return focus to).
  const opener = useRef<HTMLButtonElement | null>(null)

  return (
    <>
      {invitations.map((invitation) => {
        const status = <StatusBadge invitation={invitation} />
        const resending = resend.isPending && resend.variables.id === invitation.id
        const revokingRow = revoke.isPending && revoke.variables.id === invitation.id
        const name = invitation.display_name
        return (
          <TableRow key={invitation.id} aria-busy={revokingRow || undefined}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar size="sm" aria-hidden>
                  <AvatarFallback className="text-muted-foreground">{initialsOf(name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <span className="block truncate font-medium">{name}</span>
                  <span className="block truncate text-xs text-muted-foreground sm:hidden">{invitation.email}</span>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground max-sm:hidden">{invitation.email}</TableCell>
            <TableCell className="max-sm:whitespace-normal">
              {roleLabel(invitation.role, invitation.role_name)}
              <span className="block sm:hidden">{status}</span>
            </TableCell>
            <TableCell className="max-sm:hidden">
              {status}
              <EmailStatus status={invitation.last_email_status} errorCode={invitation.last_email_error_code} />
            </TableCell>
            <TableCell className="text-right text-muted-foreground max-sm:hidden">
              {invitation.expires_at && (
                <span className="block">
                  {t(invitation.is_expired ? 'settings.users.invitations.expired' : 'settings.users.invitations.expires', {
                    date: formatClinicDateShort(invitation.expires_at),
                  })}
                </span>
              )}
              {invitation.invited_by_name && (
                <span className="block text-xs">{t('settings.users.invitations.invitedBy', { name: invitation.invited_by_name })}</span>
              )}
            </TableCell>
            {canManage && (
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t('settings.users.invitations.resendLabel', { name })}
                    aria-disabled={resending || revokingRow || undefined}
                    className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
                    onClick={ignoreWhenInactive(resend.isPending || revokingRow, () => resend.mutate({ id: invitation.id, email: invitation.email }))}
                  >
                    {resending ? t('settings.users.invitations.resending') : t('settings.users.invitations.resend')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('settings.users.invitations.revokeLabel', { name })}
                    aria-disabled={revokingRow || undefined}
                    className={cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground')}
                    onClick={(event) => {
                      if (revokingRow) return
                      opener.current = event.currentTarget
                      confirmed.current = false
                      setRevoking(invitation)
                      setConfirmOpen(true)
                    }}
                  >
                    {t('settings.users.invitations.revoke')}
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        )
      })}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Cancelled: back to « Révoquer ». Confirmed: that row is going, focus moves on.
            event.preventDefault()
            if (confirmed.current && onRevokeConfirmed) onRevokeConfirmed()
            else opener.current?.focus()
          }}
        >
          {revoking && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.users.invitations.revokeConfirm.title', { name: revoking.display_name })}</AlertDialogTitle>
                <AlertDialogDescription>{t('settings.users.invitations.revokeConfirm.body', { email: revoking.email })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: 'destructive' })}
                  onClick={() => {
                    confirmed.current = true
                    revoke.mutate({ id: revoking.id })
                  }}
                >
                  {t('settings.users.invitations.revokeConfirm.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * « Courriel : Livré » with the status's dot (`emailStatusLabel`, so a failure of unknown outcome
 * reads « Résultat inconnu »), or « Courriel : non envoyé » when none was logged.
 */
function EmailStatus({ status, errorCode }: { status: string | null; errorCode: string | null }) {
  if (status === null) {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot tone="warning" />
        {t('settings.users.invitations.emailNone')}
      </span>
    )
  }
  const { label, tone } = emailStatusLabel(status, errorCode)
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot tone={tone} />
      {t('settings.users.invitations.email', { status: label })}
    </span>
  )
}
