import { useState } from 'react'
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
}

/**
 * The pending invitations, as rows of the users table (same columns): the name (with the address
 * under it on phones), the address, the role, « Invitation envoyée » or « Expirée » with the last
 * email's status (`emailStatusLabel`: « Adresse introuvable » for a bounce), and where the users
 * show their last sign-in, the expiry and who sent it. With users.manage, a last cell holds
 * « Renvoyer » (a new link; the previous one stops working) and « Révoquer » (after a
 * confirmation). Rows do not open a sheet.
 */
export function PendingInvitationRows({ invitations, canManage }: PendingInvitationRowsProps) {
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [revoking, setRevoking] = useState<StaffInvitation | null>(null)

  return (
    <>
      {invitations.map((invitation) => {
        const status = (
          <Badge variant={invitation.is_expired ? 'warning' : 'info'}>
            {t(invitation.is_expired ? 'settings.users.invitations.status.expired' : 'settings.users.invitations.status.sent')}
          </Badge>
        )
        const resending = resend.isPending && resend.variables.id === invitation.id
        return (
          <TableRow key={invitation.id}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar size="sm" aria-hidden>
                  <AvatarFallback className="text-muted-foreground">{initialsOf(invitation.display_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <span className="block truncate font-medium">{invitation.display_name}</span>
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
              <EmailStatus status={invitation.last_email_status} />
            </TableCell>
            <TableCell className="text-muted-foreground max-sm:hidden">
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
                    aria-disabled={resending || undefined}
                    className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
                    onClick={ignoreWhenInactive(resend.isPending, () => resend.mutate({ id: invitation.id, email: invitation.email }))}
                  >
                    {resending ? t('settings.users.invitations.resending') : t('settings.users.invitations.resend')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(invitation)}>
                    {t('settings.users.invitations.revoke')}
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        )
      })}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          {revoking && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.users.invitations.revokeConfirm.title', { name: revoking.display_name })}</AlertDialogTitle>
                <AlertDialogDescription>{t('settings.users.invitations.revokeConfirm.body', { email: revoking.email })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => revoke.mutate({ id: revoking.id })}>
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

/** « Courriel : Livré » with the status's dot, or « Courriel : non envoyé » when none was logged. */
function EmailStatus({ status }: { status: string | null }) {
  if (status === null) {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot tone="warning" />
        {t('settings.users.invitations.emailNone')}
      </span>
    )
  }
  const { label, tone } = emailStatusLabel(status, null)
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot tone={tone} />
      {t('settings.users.invitations.email', { status: label })}
    </span>
  )
}
