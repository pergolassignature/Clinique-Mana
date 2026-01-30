import { Upload } from 'lucide-react'
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
import type { DocumentTemplate } from '../types'
import { usePublishTemplate } from '../hooks'

export interface PublishTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: DocumentTemplate | null
  onConfirmed?: () => void
}

export function PublishTemplateDialog({
  open,
  onOpenChange,
  template,
  onConfirmed,
}: PublishTemplateDialogProps) {
  const publishMutation = usePublishTemplate()

  async function handleConfirm() {
    if (!template) return

    try {
      await publishMutation.mutateAsync(template.id)
      toast({
        title: 'Gabarit publie',
        description: `La version ${template.version} de « ${template.title} » est maintenant disponible.`,
      })
      onConfirmed?.()
      onOpenChange(false)
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de publier le gabarit.',
        variant: 'error',
      })
    }
  }

  if (!template) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publier le gabarit</DialogTitle>
          <DialogDescription>
            Vous etes sur le point de publier{' '}
            <strong>{template.title}</strong> (v{template.version}).
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-background-secondary p-4">
          <p className="text-sm text-foreground-secondary">
            La publication rendra ce gabarit disponible pour la generation de
            documents. Toute version precedemment publiee sera automatiquement
            archivee.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={publishMutation.isPending}
          >
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={publishMutation.isPending}
          >
            <Upload className="mr-2 h-4 w-4" />
            {publishMutation.isPending ? 'Publication...' : 'Publier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
