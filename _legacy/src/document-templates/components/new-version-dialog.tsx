import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/hooks/use-toast'
import { useCreateNewVersion } from '../hooks'

export interface NewVersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateKey: string | null
  onCreated?: () => void
}

export function NewVersionDialog({
  open,
  onOpenChange,
  templateKey,
  onCreated,
}: NewVersionDialogProps) {
  const newVersionMutation = useCreateNewVersion()

  async function handleConfirm() {
    if (!templateKey) return

    try {
      await newVersionMutation.mutateAsync({ key: templateKey })
      toast({
        title: 'Nouvelle version creee',
        description:
          'Un brouillon a ete cree a partir de la version publiee actuelle.',
      })
      onCreated?.()
      onOpenChange(false)
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de creer une nouvelle version.',
        variant: 'error',
      })
    }
  }

  if (!templateKey) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle version</DialogTitle>
          <DialogDescription>
            Creer une nouvelle version brouillon pour le gabarit{' '}
            <strong>{templateKey}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-background-secondary p-4">
          <p className="text-sm text-foreground-secondary">
            Creer une nouvelle version brouillon a partir de la version publiee
            actuelle. La version publiee restera active jusqu'a la publication
            de la nouvelle version.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={newVersionMutation.isPending}
          >
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={newVersionMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {newVersionMutation.isPending
              ? 'Creation...'
              : 'Creer la version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
