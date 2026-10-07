import { FileText } from 'lucide-react'
import { EmptyState } from '@/shared/components/empty-state'
import type { DocumentTemplate } from '../types'
import { TemplateListItem } from './template-list-item'

export interface TemplateListProps {
  templates: DocumentTemplate[]
  onEdit: (template: DocumentTemplate) => void
  onPublish: (template: DocumentTemplate) => void
  onNewVersion: (template: DocumentTemplate) => void
  onArchive: (template: DocumentTemplate) => void
  onPreview: (template: DocumentTemplate) => void
}

/**
 * Groups templates by key, showing published version first, then draft.
 * Archived templates are listed after active ones within each group.
 */
function groupByKey(templates: DocumentTemplate[]) {
  const groups = new Map<string, DocumentTemplate[]>()

  for (const tpl of templates) {
    const existing = groups.get(tpl.key) ?? []
    existing.push(tpl)
    groups.set(tpl.key, existing)
  }

  // Sort within each group: published first, then draft, then archived
  const statusOrder: Record<string, number> = { published: 0, draft: 1, archived: 2 }
  for (const [key, items] of groups) {
    items.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3))
    groups.set(key, items)
  }

  return groups
}

export function TemplateList({
  templates,
  onEdit,
  onPublish,
  onNewVersion,
  onArchive,
  onPreview,
}: TemplateListProps) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="Aucun gabarit"
        description="Creez votre premier gabarit de document pour commencer."
      />
    )
  }

  const grouped = groupByKey(templates)

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([key, items]) => (
        <div key={key} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {key}
          </h3>
          <div className="space-y-2">
            {items.map((template) => (
              <TemplateListItem
                key={template.id}
                template={template}
                onEdit={onEdit}
                onPublish={onPublish}
                onNewVersion={onNewVersion}
                onArchive={onArchive}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
