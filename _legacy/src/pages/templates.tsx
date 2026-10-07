import { useState, useMemo } from 'react'
import { Plus, Search, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  TemplateList,
  TemplateEditorSheet,
  TemplatePreviewDialog,
  PublishTemplateDialog,
  NewVersionDialog,
} from '@/document-templates/components'
import { useTemplates, useArchiveTemplate } from '@/document-templates/hooks'
import type { DocumentTemplate } from '@/document-templates/types'

type StatusFilter = 'all' | 'published' | 'draft' | 'archived'

export function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Editor sheet state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null)

  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<DocumentTemplate | null>(null)

  // Publish dialog state
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishTemplate, setPublishTemplate] = useState<DocumentTemplate | null>(null)

  // New version dialog state
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [newVersionKey, setNewVersionKey] = useState<string | null>(null)

  // Data fetching
  const { data: templates = [], isLoading, refetch } = useTemplates()

  // Archive mutation
  const archiveMutation = useArchiveTemplate()

  // Count by status
  const countByStatus = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: templates.length,
      published: 0,
      draft: 0,
      archived: 0,
    }
    for (const tpl of templates) {
      if (tpl.status === 'published') counts.published++
      else if (tpl.status === 'draft') counts.draft++
      else if (tpl.status === 'archived') counts.archived++
    }
    return counts
  }, [templates])

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    let result = templates
    if (statusFilter !== 'all') {
      result = result.filter((tpl) => tpl.status === statusFilter)
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (tpl) =>
          tpl.title.toLowerCase().includes(query) ||
          tpl.key.toLowerCase().includes(query)
      )
    }
    return result
  }, [templates, statusFilter, searchQuery])

  // Handlers
  const handleCreate = () => {
    setEditingTemplate(null)
    setEditorOpen(true)
  }

  const handleEdit = (template: DocumentTemplate) => {
    setEditingTemplate(template)
    setEditorOpen(true)
  }

  const handlePreview = (template: DocumentTemplate) => {
    setPreviewTemplate(template)
    setPreviewOpen(true)
  }

  const handlePublish = (template: DocumentTemplate) => {
    setPublishTemplate(template)
    setPublishOpen(true)
  }

  const handleNewVersion = (template: DocumentTemplate) => {
    setNewVersionKey(template.key)
    setNewVersionOpen(true)
  }

  const handleArchive = async (template: DocumentTemplate) => {
    try {
      await archiveMutation.mutateAsync(template.id)
      toast({ title: 'Gabarit archive' })
      refetch()
    } catch (err) {
      toast({
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible d\'archiver le gabarit.',
        variant: 'error',
      })
    }
  }

  const handleEditorSuccess = () => {
    refetch()
  }

  const handlePublishSuccess = () => {
    refetch()
  }

  const handleNewVersionSuccess = () => {
    refetch()
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-sage-500" />
      </div>
    )
  }

  const hasTemplates = templates.length > 0
  const hasResults = filteredTemplates.length > 0

  return (
    <div className="space-y-6">
      {/* Header with action button */}
      <div className="flex justify-end gap-2">
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4" />
          {t('pages.templates.page.action')}
        </Button>
      </div>

      {/* Filters row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter (segmented control) */}
        <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
          {(['all', 'published', 'draft', 'archived'] as StatusFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={cn(
                'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
                statusFilter === filter
                  ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                  : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
              )}
            >
              {t(`pages.templates.page.filters.${filter}`)}
              <span className="text-[10px] text-foreground-muted">({countByStatus[filter]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('pages.templates.page.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {/* Content */}
      {!hasTemplates ? (
        <EmptyState
          title={t('pages.templates.page.empty.title')}
          description={t('pages.templates.page.empty.description')}
          action={
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              {t('pages.templates.page.action')}
            </Button>
          }
        />
      ) : !hasResults ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-foreground-muted">
            {t('pages.templates.page.noResults')}
          </p>
          {searchQuery.trim() && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="mt-2 text-sage-600"
            >
              Effacer la recherche
            </Button>
          )}
        </div>
      ) : (
        <TemplateList
          templates={filteredTemplates}
          onEdit={handleEdit}
          onPreview={handlePreview}
          onPublish={handlePublish}
          onArchive={handleArchive}
          onNewVersion={handleNewVersion}
        />
      )}

      {/* Template count footer */}
      {hasResults && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-foreground-muted text-center">
            {filteredTemplates.length === templates.length
              ? `${templates.length} ${t('pages.templates.page.count.total')}`
              : `${filteredTemplates.length} ${t('pages.templates.page.count.filtered')} ${templates.length}`}
          </p>
        </div>
      )}

      {/* Editor sheet */}
      <TemplateEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editingTemplate}
        onSaved={handleEditorSuccess}
      />

      {/* Preview dialog */}
      <TemplatePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        template={previewTemplate}
      />

      {/* Publish dialog */}
      <PublishTemplateDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        template={publishTemplate}
        onConfirmed={handlePublishSuccess}
      />

      {/* New version dialog */}
      <NewVersionDialog
        open={newVersionOpen}
        onOpenChange={setNewVersionOpen}
        templateKey={newVersionKey}
        onCreated={handleNewVersionSuccess}
      />
    </div>
  )
}
