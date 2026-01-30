import { useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog'
import { Badge } from '@/shared/ui/badge'
import type { DocumentTemplate } from '../types'
import { renderTemplatePreview } from '../template-engine'
import { TemplateStatusBadge } from './template-status-badge'

export interface TemplatePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: DocumentTemplate | null
}

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  template,
}: TemplatePreviewDialogProps) {
  const previewHtml = useMemo(() => {
    if (!template?.content) return ''
    return renderTemplatePreview(template.content)
  }, [template?.content])

  if (!template) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-4xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{template.title}</DialogTitle>
            <TemplateStatusBadge status={template.status} />
            <Badge variant="outline">v{template.version}</Badge>
          </div>
          <DialogDescription>
            Apercu avec les donnees d'exemple. Les variables sont remplacees par
            des valeurs fictives.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          {template.content ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <iframe
                title="Apercu du gabarit"
                srcDoc={previewHtml}
                sandbox="allow-same-origin"
                className="h-[600px] w-full bg-white"
              />
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-foreground-muted">
              Ce gabarit n'a pas de contenu.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
