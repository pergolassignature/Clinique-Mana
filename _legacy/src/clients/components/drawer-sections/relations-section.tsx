import { useState } from 'react'
import { Users, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import type { ClientWithRelations, RelationType } from '../../types'
import { useClientRelations, useCreateClientRelation, useDeleteClientRelation } from '../../hooks'
import { AddRelationDialog } from './edit-dialogs'
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

interface RelationsSectionProps {
  client: ClientWithRelations
  onViewClient?: (clientId: string) => void
}

const relationTypeLabels: Record<RelationType, string> = {
  parent: 'clients.drawer.relations.types.parent',
  child: 'clients.drawer.relations.types.child',
  spouse: 'clients.drawer.relations.types.spouse',
  sibling: 'clients.drawer.relations.types.sibling',
  guardian: 'clients.drawer.relations.types.guardian',
  ward: 'clients.drawer.relations.types.ward',
  other: 'clients.drawer.relations.types.other',
}

export function RelationsSection({
  client,
  onViewClient,
}: RelationsSectionProps) {
  const { toast } = useToast()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedRelation, setSelectedRelation] = useState<{ id: string; relatedClientId: string } | null>(null)

  // Fetch relations from database
  const { data: relations = [], isLoading } = useClientRelations(client.id)
  const createRelation = useCreateClientRelation()
  const deleteRelation = useDeleteClientRelation()

  const handleAddRelation = async (data: {
    relatedClientId: string
    relatedClientName: string
    relationType: RelationType
    notes?: string
  }) => {
    try {
      await createRelation.mutateAsync({
        clientId: client.id,
        relatedClientId: data.relatedClientId,
        relationType: data.relationType,
        notes: data.notes,
      })
      setAddDialogOpen(false)
      toast({
        title: 'Relation ajoutée',
        description: `${data.relatedClientName} a été ajouté comme ${t(relationTypeLabels[data.relationType] as Parameters<typeof t>[0])}.`,
      })
    } catch (error) {
      console.error('Failed to create relation:', error)
      toast({
        title: 'Erreur',
        description: 'Impossible de créer la relation.',
        variant: 'error',
      })
    }
  }

  const handleDeleteRelation = async () => {
    if (!selectedRelation) return

    try {
      await deleteRelation.mutateAsync({
        relationId: selectedRelation.id,
        clientId: client.id,
        relatedClientId: selectedRelation.relatedClientId,
      })
      toast({
        title: 'Relation supprimée',
        description: 'La relation a été supprimée des deux dossiers.',
      })
    } catch (error) {
      console.error('Failed to delete relation:', error)
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer la relation.',
        variant: 'error',
      })
    } finally {
      setSelectedRelation(null)
      setDeleteDialogOpen(false)
    }
  }

  const openDeleteDialog = (relationId: string, relatedClientId: string) => {
    setSelectedRelation({ id: relationId, relatedClientId })
    setDeleteDialogOpen(true)
  }

  return (
    <>
      <AccordionItem value="relations" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-sage-500" />
            <span>{t('clients.drawer.sections.relations')}</span>
            {relations.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {relations.length}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {/* Add relation button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('clients.drawer.relations.addRelation')}
            </Button>

            {/* Loading state */}
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : relations.length > 0 ? (
              <ul className="space-y-2">
                {relations.map((relation) => (
                  <li
                    key={relation.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg bg-background-secondary",
                      onViewClient && "cursor-pointer hover:bg-background-tertiary transition-colors"
                    )}
                    onClick={() => onViewClient?.(relation.relatedClientId)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {relation.relatedClientName}
                        </span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {t(relationTypeLabels[relation.relationType] as Parameters<typeof t>[0])}
                        </Badge>
                      </div>
                      {relation.notes && (
                        <p className="text-xs text-foreground-muted mt-1 truncate">
                          {relation.notes}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-wine-600 hover:text-wine-700 hover:bg-wine-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDeleteDialog(relation.id, relation.relatedClientId)
                        }}
                        title={t('clients.drawer.relations.removeRelation')}
                        disabled={deleteRelation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground-muted italic py-2">
                {t('clients.drawer.relations.noRelations')}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Add Relation Dialog */}
      <AddRelationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSave={handleAddRelation}
        excludeClientIds={[client.id, ...relations.map((r) => r.relatedClientId)]}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('clients.drawer.relations.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('clients.drawer.relations.deleteDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedRelation(null)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRelation}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
