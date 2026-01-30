import { Pencil, Upload, Eye, Plus, Archive } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { DocumentTemplate } from '../types'
import { TemplateStatusBadge } from './template-status-badge'

export interface TemplateListItemProps {
  template: DocumentTemplate
  onEdit?: (template: DocumentTemplate) => void
  onPublish?: (template: DocumentTemplate) => void
  onNewVersion?: (template: DocumentTemplate) => void
  onArchive?: (template: DocumentTemplate) => void
  onPreview?: (template: DocumentTemplate) => void
}

export function TemplateListItem({
  template,
  onEdit,
  onPublish,
  onNewVersion,
  onArchive,
  onPreview,
}: TemplateListItemProps) {
  const displayDate = template.published_at ?? template.created_at

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-background-secondary/50">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <TemplateStatusBadge status={template.status} />
          <h3 className="truncate text-sm font-medium text-foreground">
            {template.title}
          </h3>
          <Badge variant="outline" className="shrink-0">
            v{template.version}
          </Badge>
        </div>
        {template.description && (
          <p className="truncate text-sm text-foreground-secondary">
            {template.description}
          </p>
        )}
        <p className="text-xs text-foreground-muted">
          {formatClinicDateShort(displayDate)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {template.status === 'draft' && (
          <>
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(template)}
                title="Modifier"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onPublish && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onPublish(template)}
                title="Publier"
              >
                <Upload className="h-4 w-4" />
              </Button>
            )}
            {onArchive && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onArchive(template)}
                title="Archiver"
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
          </>
        )}

        {template.status === 'published' && (
          <>
            {onNewVersion && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onNewVersion(template)}
                title="Nouvelle version"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onPreview(template)}
                title="Apercu"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {onArchive && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onArchive(template)}
                title="Archiver"
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
          </>
        )}

        {template.status === 'archived' && onPreview && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPreview(template)}
            title="Apercu"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
