import { useState } from 'react'
import { Archive, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
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
import type { ClientWithRelations } from '../types'

interface DrawerFooterProps {
  client: ClientWithRelations
  onArchive?: () => void
  onDelete?: () => void
}

export function DrawerFooter({ client, onArchive, onDelete }: DrawerFooterProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // TODO: Check user role for permissions
  const canArchive = true // Would check: profile?.role === 'admin' || profile?.role === 'staff'
  const canDelete = true // Would check: profile?.role === 'admin'

  return (
    <>
      <div className="flex items-center gap-3">
        {/* Archive button */}
        {canArchive && onArchive && (
          <Button
            variant="outline"
            onClick={onArchive}
            className="flex-1"
          >
            <Archive className="h-4 w-4 mr-2" />
            {client.isArchived
              ? t('clients.drawer.actions.unarchive')
              : t('clients.drawer.actions.archive')
            }
          </Button>
        )}

        {/* Delete button */}
        {canDelete && onDelete && (
          <Button
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
            className="flex-1"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('clients.drawer.actions.delete')}
          </Button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('clients.drawer.actions.deleteConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('clients.drawer.actions.deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('clients.drawer.actions.deleteConfirm.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.()
                setShowDeleteDialog(false)
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('clients.drawer.actions.deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
