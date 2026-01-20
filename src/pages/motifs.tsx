import { useState, useMemo, useCallback } from 'react'
import { Plus, Search, LayoutGrid, List, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  MOTIF_DISPLAY_GROUPS,
  MotifDisclaimerBanner,
  MotifCard,
  MotifCategoryGroup,
  ArchiveMotifDialog,
  CreateMotifDialog,
  useMotifs,
  useMotifMutations,
  type Motif,
} from '@/motifs'

// View modes: grouped by sphere (default) or flat A-Z list
type ViewMode = 'grouped' | 'flat'

// Status filter modes
type StatusFilter = 'active' | 'archived' | 'all'

// Extended motif type with id for mutations
interface MotifWithId extends Motif {
  id: string
}

export function MotifsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [motifToArchive, setMotifToArchive] = useState<MotifWithId | null>(null)

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch all motifs from database (including inactive for management view)
  const { motifs: dbMotifs, isLoading, error, refetch } = useMotifs({ includeInactive: true })

  // Mutations
  const { archiveMotif, unarchiveMotif, createMotif, validateKey } = useMotifMutations()

  // Transform database motifs to UI motifs with ID
  const allMotifs: MotifWithId[] = useMemo(() => {
    return dbMotifs.map((dbMotif) => ({
      id: dbMotif.id,
      key: dbMotif.key,
      label: dbMotif.label,
      isRestricted: dbMotif.is_restricted,
      isActive: dbMotif.is_active,
    }))
  }, [dbMotifs])

  // Filter by status
  const statusFilteredMotifs = useMemo(() => {
    switch (statusFilter) {
      case 'active':
        return allMotifs.filter((m) => m.isActive)
      case 'archived':
        return allMotifs.filter((m) => !m.isActive)
      case 'all':
      default:
        return allMotifs
    }
  }, [allMotifs, statusFilter])

  // Filter motifs based on search query (label only)
  const filteredMotifs = useMemo(() => {
    if (!searchQuery.trim()) return statusFilteredMotifs

    const query = searchQuery.toLowerCase().trim()
    return statusFilteredMotifs.filter((motif) =>
      motif.label.toLowerCase().includes(query)
    )
  }, [statusFilteredMotifs, searchQuery])

  // Sort motifs alphabetically for flat view
  const sortedMotifs = useMemo(() => {
    return [...filteredMotifs].sort((a, b) =>
      a.label.localeCompare(b.label, 'fr-CA')
    )
  }, [filteredMotifs])

  // Group motifs by display groups for grouped view
  const groupedMotifs = useMemo(() => {
    // Create a map of motif key -> motif for quick lookup
    const motifMap = new Map(filteredMotifs.map((m) => [m.key, m]))

    // Build grouped structure
    const groups = MOTIF_DISPLAY_GROUPS.map((group) => ({
      ...group,
      motifs: group.motifKeys
        .map((key) => motifMap.get(key))
        .filter((m): m is MotifWithId => m !== undefined),
    })).filter((group) => group.motifs.length > 0)

    // Find ungrouped motifs (not in any display group)
    const groupedKeys = new Set(MOTIF_DISPLAY_GROUPS.flatMap((g) => g.motifKeys))
    const ungroupedMotifs = filteredMotifs.filter((m) => !groupedKeys.has(m.key))

    // Add "Other" group if there are ungrouped motifs
    if (ungroupedMotifs.length > 0) {
      groups.push({
        labelKey: 'pages.motifs.groups.other',
        motifKeys: ungroupedMotifs.map((m) => m.key),
        motifs: ungroupedMotifs,
      })
    }

    return groups
  }, [filteredMotifs])

  // Counts for filter badges
  const activeCount = useMemo(() => allMotifs.filter((m) => m.isActive).length, [allMotifs])
  const archivedCount = useMemo(() => allMotifs.filter((m) => !m.isActive).length, [allMotifs])

  const hasMotifs = allMotifs.length > 0
  const hasResults = filteredMotifs.length > 0

  // Handle archive action
  const handleArchiveClick = useCallback((motif: MotifWithId) => {
    setMotifToArchive(motif)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirmation
  const handleArchiveConfirm = useCallback(async () => {
    if (!motifToArchive) return { success: false }

    const result = await archiveMotif(motifToArchive.id)

    if (!result.success) {
      // Check if it's a permission error (RLS)
      const isPermissionError = result.error?.message?.toLowerCase().includes('permission') ||
        result.error?.message?.toLowerCase().includes('policy')

      toast({
        title: isPermissionError
          ? t('pages.motifs.errors.permissionTitle')
          : t('pages.motifs.errors.archiveFailed'),
        description: isPermissionError
          ? t('pages.motifs.errors.permissionDescription')
          : result.error?.message,
        variant: 'error',
      })
    }

    return result
  }, [motifToArchive, archiveMotif])

  // Handle archive success
  const handleArchiveSuccess = useCallback(() => {
    refetch()
    setMotifToArchive(null)
  }, [refetch])

  // Handle restore action (direct, no confirmation needed)
  const handleRestore = useCallback(async (motif: MotifWithId) => {
    const result = await unarchiveMotif(motif.id)

    if (result.success) {
      toast({
        title: t('pages.motifs.restore.success'),
      })
      refetch()
    } else {
      const isPermissionError = result.error?.message?.toLowerCase().includes('permission') ||
        result.error?.message?.toLowerCase().includes('policy')

      toast({
        title: isPermissionError
          ? t('pages.motifs.errors.permissionTitle')
          : t('pages.motifs.errors.restoreFailed'),
        description: isPermissionError
          ? t('pages.motifs.errors.permissionDescription')
          : result.error?.message,
        variant: 'error',
      })
    }
  }, [unarchiveMotif, refetch])

  // Handle create submission
  const handleCreateSubmit = useCallback(async (input: { key: string; label: string }) => {
    const result = await createMotif(input)

    if (!result.success) {
      const isPermissionError = result.error?.message?.toLowerCase().includes('permission') ||
        result.error?.message?.toLowerCase().includes('policy')

      toast({
        title: isPermissionError
          ? t('pages.motifs.errors.permissionTitle')
          : t('pages.motifs.errors.createFailed'),
        description: isPermissionError
          ? t('pages.motifs.errors.permissionDescription')
          : result.error?.message,
        variant: 'error',
      })
    }

    return result
  }, [createMotif])

  // Handle create success
  const handleCreateSuccess = useCallback(() => {
    toast({
      title: t('pages.motifs.create.success'),
    })
    refetch()
  }, [refetch])

  // Render motif card with actions
  const renderMotifCard = useCallback((motif: MotifWithId) => (
    <MotifCard
      key={motif.key}
      motifKey={motif.key}
      label={motif.label}
      isRestricted={motif.isRestricted}
      isActive={motif.isActive}
      showActions
      onArchive={() => handleArchiveClick(motif)}
      onRestore={() => handleRestore(motif)}
    />
  ), [handleArchiveClick, handleRestore])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-sage-500" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Erreur de chargement"
          description={`Impossible de charger les motifs: ${error.message}`}
          action={
            <Button onClick={() => window.location.reload()}>
              Réessayer
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action button */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('pages.motifs.page.action')}
        </Button>
      </div>

      {/* Disclaimer banner */}
      <MotifDisclaimerBanner variant="info" />

      {/* Filters row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter (segmented control) */}
        <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'active'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.motifs.page.filters.active')}
            <span className="text-[10px] text-foreground-muted">({activeCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'archived'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.motifs.page.filters.archived')}
            <span className="text-[10px] text-foreground-muted">({archivedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            {t('pages.motifs.page.filters.all')}
          </button>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              viewMode === 'grouped'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {t('pages.motifs.page.viewGrouped')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={cn(
              'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
              viewMode === 'flat'
                ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
            )}
          >
            <List className="h-3.5 w-3.5" />
            {t('pages.motifs.page.viewFlat')}
          </button>
        </div>
      </div>

      {/* Search input */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('pages.motifs.page.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {/* Content */}
      {!hasMotifs ? (
        // Empty state - no motifs defined at all
        <EmptyState
          title={t('pages.motifs.empty.title')}
          description={t('pages.motifs.empty.description')}
          action={
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('pages.motifs.page.action')}
            </Button>
          }
        />
      ) : !hasResults ? (
        // No search/filter results
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-foreground-muted">
            {searchQuery.trim()
              ? t('pages.motifs.page.noResults')
              : statusFilter === 'archived'
                ? 'Aucun motif archivé'
                : 'Aucun motif actif'}
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
      ) : viewMode === 'grouped' ? (
        // Grouped view (default)
        <div className="space-y-8">
          {groupedMotifs.map((group) => (
            <MotifCategoryGroup
              key={group.labelKey}
              categoryLabel={t(group.labelKey as Parameters<typeof t>[0])}
              motifs={group.motifs}
              collapsible
              defaultExpanded
              renderCard={renderMotifCard}
            />
          ))}
        </div>
      ) : (
        // Flat A-Z view
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedMotifs.map(renderMotifCard)}
        </div>
      )}

      {/* Motif count footer */}
      {hasResults && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-foreground-muted text-center">
            {filteredMotifs.length === statusFilteredMotifs.length
              ? `${statusFilteredMotifs.length} motifs ${statusFilter === 'archived' ? 'archivés' : statusFilter === 'active' ? 'actifs' : 'au total'}`
              : `${filteredMotifs.length} sur ${statusFilteredMotifs.length} motifs`}
          </p>
        </div>
      )}

      {/* Archive confirmation dialog */}
      {motifToArchive && (
        <ArchiveMotifDialog
          open={archiveDialogOpen}
          onOpenChange={setArchiveDialogOpen}
          motifLabel={motifToArchive.label}
          onConfirm={handleArchiveConfirm}
          onSuccess={handleArchiveSuccess}
        />
      )}

      {/* Create motif dialog */}
      <CreateMotifDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateSubmit}
        validateKey={validateKey}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}
