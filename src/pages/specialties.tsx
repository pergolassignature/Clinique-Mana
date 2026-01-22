// src/pages/specialties.tsx
// Settings page for managing specialties

import { useState, useMemo, useCallback } from 'react'
import { Plus, Search, LayoutGrid, List, Loader2, MoreHorizontal, Archive, RotateCcw, Users } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import {
  useSpecialties,
  useSpecialtyMutations,
  useSpecialtyUsageCount,
  type Specialty,
  type SpecialtyCategory,
  SPECIALTY_CATEGORY_LABELS,
  SPECIALTY_CATEGORY_ORDER,
  SPECIALTY_CATEGORY_DESCRIPTIONS,
} from '@/specialties'

// View modes: grouped by category (default) or flat A-Z list
type ViewMode = 'grouped' | 'flat'

// Status filter modes
type StatusFilter = 'active' | 'archived' | 'all'

export function SpecialtiesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [specialtyToArchive, setSpecialtyToArchive] = useState<Specialty | null>(null)

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch all specialties (including inactive for management view)
  const { data: allSpecialties = [], isLoading, error, refetch } = useSpecialties({ includeInactive: true })

  // Mutations
  const { archiveSpecialty, unarchiveSpecialty, createSpecialty, validateCode } = useSpecialtyMutations()

  // Usage count for archive warning
  const { data: usageCount } = useSpecialtyUsageCount(specialtyToArchive?.id)

  // Filter by status
  const statusFilteredSpecialties = useMemo(() => {
    switch (statusFilter) {
      case 'active':
        return allSpecialties.filter((s) => s.is_active)
      case 'archived':
        return allSpecialties.filter((s) => !s.is_active)
      case 'all':
      default:
        return allSpecialties
    }
  }, [allSpecialties, statusFilter])

  // Filter by search query (name_fr or code)
  const filteredSpecialties = useMemo(() => {
    if (!searchQuery.trim()) return statusFilteredSpecialties

    const query = searchQuery.toLowerCase().trim()
    return statusFilteredSpecialties.filter(
      (s) =>
        s.name_fr.toLowerCase().includes(query) ||
        s.code.toLowerCase().includes(query)
    )
  }, [statusFilteredSpecialties, searchQuery])

  // Sort alphabetically for flat view
  const sortedSpecialties = useMemo(() => {
    return [...filteredSpecialties].sort((a, b) =>
      a.name_fr.localeCompare(b.name_fr, 'fr-CA')
    )
  }, [filteredSpecialties])

  // Group by category for grouped view
  const groupedSpecialties = useMemo(() => {
    const groups: Record<SpecialtyCategory, Specialty[]> = {
      clientele: [],
      therapy_type: [],
      issue: [],
      modality: [],
    }

    for (const specialty of filteredSpecialties) {
      groups[specialty.category].push(specialty)
    }

    // Sort within each group by sort_order, then name
    for (const category of Object.keys(groups) as SpecialtyCategory[]) {
      groups[category].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
        return a.name_fr.localeCompare(b.name_fr, 'fr-CA')
      })
    }

    return groups
  }, [filteredSpecialties])

  // Counts for filter badges
  const activeCount = useMemo(() => allSpecialties.filter((s) => s.is_active).length, [allSpecialties])
  const archivedCount = useMemo(() => allSpecialties.filter((s) => !s.is_active).length, [allSpecialties])

  const hasSpecialties = allSpecialties.length > 0
  const hasResults = filteredSpecialties.length > 0

  // Handle archive action
  const handleArchiveClick = useCallback((specialty: Specialty) => {
    setSpecialtyToArchive(specialty)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirmation
  const handleArchiveConfirm = useCallback(async () => {
    if (!specialtyToArchive) return

    const result = await archiveSpecialty(specialtyToArchive.id)

    if (result.success) {
      toast({ title: 'Spécialité archivée' })
      refetch()
      setArchiveDialogOpen(false)
      setSpecialtyToArchive(null)
    } else {
      toast({
        title: 'Erreur',
        description: result.error?.message || 'Impossible d\'archiver la spécialité',
        variant: 'error',
      })
    }
  }, [specialtyToArchive, archiveSpecialty, refetch])

  // Handle restore action
  const handleRestore = useCallback(async (specialty: Specialty) => {
    const result = await unarchiveSpecialty(specialty.id)

    if (result.success) {
      toast({ title: 'Spécialité restaurée' })
      refetch()
    } else {
      toast({
        title: 'Erreur',
        description: result.error?.message || 'Impossible de restaurer la spécialité',
        variant: 'error',
      })
    }
  }, [unarchiveSpecialty, refetch])

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
          description={`Impossible de charger les spécialités: ${error.message}`}
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
    <div className="space-y-6 p-6">
      {/* Action button */}
      <div className="flex justify-end">
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Créer une spécialité
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm text-sky-800">
          Les spécialités sont utilisées pour le filtrage et le jumelage des professionnels avec les demandes.
          La catégorie <strong>Clientèle</strong> est particulièrement importante pour l'éligibilité des professionnels.
        </p>
      </div>

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
            Actives
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
            Archivées
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
            Toutes
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
            Par catégorie
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
            Vue simple (A–Z)
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
          placeholder="Rechercher une spécialité..."
          className="pl-9"
        />
      </div>

      {/* Content */}
      {!hasSpecialties ? (
        <EmptyState
          title="Aucune spécialité"
          description="Commencez par créer des spécialités pour vos professionnels."
          action={
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Créer une spécialité
            </Button>
          }
        />
      ) : !hasResults ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-foreground-muted">
            {searchQuery.trim()
              ? 'Aucun résultat pour cette recherche'
              : statusFilter === 'archived'
                ? 'Aucune spécialité archivée'
                : 'Aucune spécialité active'}
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
        // Grouped view by category
        <div className="space-y-8">
          {SPECIALTY_CATEGORY_ORDER.map((category) => {
            const categorySpecialties = groupedSpecialties[category]
            if (categorySpecialties.length === 0) return null

            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    {SPECIALTY_CATEGORY_LABELS[category]}
                  </h3>
                  <span className="text-xs text-foreground-muted">({categorySpecialties.length})</span>
                </div>
                <p className="text-xs text-foreground-muted">
                  {SPECIALTY_CATEGORY_DESCRIPTIONS[category]}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {categorySpecialties.map((specialty) => (
                    <SpecialtyCard
                      key={specialty.id}
                      specialty={specialty}
                      onArchive={() => handleArchiveClick(specialty)}
                      onRestore={() => handleRestore(specialty)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        // Flat A-Z view
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedSpecialties.map((specialty) => (
            <SpecialtyCard
              key={specialty.id}
              specialty={specialty}
              onArchive={() => handleArchiveClick(specialty)}
              onRestore={() => handleRestore(specialty)}
              showCategory
            />
          ))}
        </div>
      )}

      {/* Count footer */}
      {hasResults && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-foreground-muted text-center">
            {filteredSpecialties.length === statusFilteredSpecialties.length
              ? `${statusFilteredSpecialties.length} spécialités ${statusFilter === 'archived' ? 'archivées' : statusFilter === 'active' ? 'actives' : 'au total'}`
              : `${filteredSpecialties.length} sur ${statusFilteredSpecialties.length} spécialités`}
          </p>
        </div>
      )}

      {/* Archive confirmation dialog */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archiver la spécialité</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir archiver « {specialtyToArchive?.name_fr} » ?
            </DialogDescription>
          </DialogHeader>
          {usageCount !== undefined && usageCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-honey-200 bg-honey-50 p-3">
              <Users className="h-4 w-4 text-honey-600" />
              <p className="text-sm text-honey-800">
                Cette spécialité est utilisée par {usageCount} professionnel{usageCount > 1 ? 's' : ''}.
                L'archivage ne supprimera pas ces associations.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleArchiveConfirm}>
              Archiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create specialty dialog */}
      <CreateSpecialtyDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={async (input) => {
          const result = await createSpecialty(input)
          if (result.success) {
            toast({ title: 'Spécialité créée' })
            refetch()
            setCreateDialogOpen(false)
          } else {
            toast({
              title: 'Erreur',
              description: result.error?.message || 'Impossible de créer la spécialité',
              variant: 'error',
            })
          }
          return result
        }}
        validateCode={validateCode}
      />
    </div>
  )
}

// =============================================================================
// SPECIALTY CARD COMPONENT
// =============================================================================

interface SpecialtyCardProps {
  specialty: Specialty
  onArchive: () => void
  onRestore: () => void
  showCategory?: boolean
}

function SpecialtyCard({ specialty, onArchive, onRestore, showCategory }: SpecialtyCardProps) {
  return (
    <div
      className={cn(
        'group relative rounded-lg border p-3 transition-colors',
        specialty.is_active
          ? 'border-border bg-background hover:border-sage-200 hover:shadow-sm'
          : 'border-border-light bg-background-secondary/50 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className={cn(
            'text-sm font-medium truncate',
            !specialty.is_active && 'text-foreground-muted'
          )}>
            {specialty.name_fr}
          </h4>
          <p className="text-xs text-foreground-muted font-mono truncate">
            {specialty.code}
          </p>
          {showCategory && (
            <Badge variant="secondary" className="mt-1 text-[10px]">
              {SPECIALTY_CATEGORY_LABELS[specialty.category]}
            </Badge>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {specialty.is_active ? (
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="h-4 w-4 mr-2" />
                Archiver
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onRestore}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Restaurer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// =============================================================================
// CREATE SPECIALTY DIALOG
// =============================================================================

interface CreateSpecialtyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { code: string; name_fr: string; category: SpecialtyCategory }) => Promise<{ success: boolean }>
  validateCode: (code: string) => Promise<boolean>
}

function CreateSpecialtyDialog({ open, onOpenChange, onSubmit, validateCode }: CreateSpecialtyDialogProps) {
  const [code, setCode] = useState('')
  const [nameFr, setNameFr] = useState('')
  const [category, setCategory] = useState<SpecialtyCategory>('clientele')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const resetForm = () => {
    setCode('')
    setNameFr('')
    setCategory('clientele')
    setCodeError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!code.trim() || !nameFr.trim()) return

    setIsSubmitting(true)
    setCodeError(null)

    // Validate code uniqueness
    const isUnique = await validateCode(code.trim())
    if (!isUnique) {
      setCodeError('Ce code est déjà utilisé')
      setIsSubmitting(false)
      return
    }

    const result = await onSubmit({
      code: code.trim().toLowerCase().replace(/\s+/g, '_'),
      name_fr: nameFr.trim(),
      category,
    })

    setIsSubmitting(false)

    if (result.success) {
      resetForm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) resetForm()
      onOpenChange(newOpen)
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer une spécialité</DialogTitle>
          <DialogDescription>
            Ajoutez une nouvelle spécialité pour vos professionnels.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name_fr">Nom (français)</Label>
            <Input
              id="name_fr"
              value={nameFr}
              onChange={(e) => setNameFr(e.target.value)}
              placeholder="ex: Adultes"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Code (identifiant unique)</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setCodeError(null)
              }}
              placeholder="ex: adults"
              required
            />
            {codeError && (
              <p className="text-xs text-wine-600">{codeError}</p>
            )}
            <p className="text-xs text-foreground-muted">
              Utilisé en interne pour le filtrage. Lettres minuscules et underscores seulement.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Catégorie</Label>
            <Select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as SpecialtyCategory)}
            >
              {SPECIALTY_CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {SPECIALTY_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting || !code.trim() || !nameFr.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Création...
                </>
              ) : (
                'Créer'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
