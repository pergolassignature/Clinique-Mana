import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ArchiveMotifDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  motifLabel: string
  onConfirm: () => Promise<{ success: boolean; error?: Error }>
  onSuccess?: () => void
}

export function ArchiveMotifDialog({
  open,
  onOpenChange,
  motifLabel,
  onConfirm,
  onSuccess,
}: ArchiveMotifDialogProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    setIsLoading(true)
    const result = await onConfirm()
    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      onSuccess?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pages.motifs.archive.title')}</DialogTitle>
          <DialogDescription className="pt-2">
            <span className="font-medium text-foreground">{motifLabel}</span>
            <br />
            <span className="mt-2 block">
              {t('pages.motifs.archive.description')}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t('pages.motifs.archive.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('pages.motifs.archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
