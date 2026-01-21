import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/shared/ui/sheet'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Accordion } from '@/shared/ui/accordion'
import { Skeleton } from '@/shared/ui/skeleton'
import { DrawerHeader } from './drawer-header'
import { DrawerFooter } from './drawer-footer'
import { InfoSection } from './drawer-sections/info-section'
import { ExternalPayersSection } from './drawer-sections/external-payers-section'
import { VisitsSection } from './drawer-sections/visits-section'
import { NotesSection } from './drawer-sections/notes-section'
import { ConsentsSection } from './drawer-sections/consents-section'
import { RelationsSection } from './drawer-sections/relations-section'
import { HistorySection } from './drawer-sections/history-section'
import { useClient, useUpdateClient } from '../hooks'
import { useToast } from '@/shared/hooks/use-toast'
import type { ClientWithRelations } from '../types'

interface ClientDrawerProps {
  clientId: string | null
  isOpen: boolean
  onClose: () => void
  onArchive?: (clientId: string) => void
  onDelete?: (clientId: string) => void
  onViewClient?: (clientId: string) => void
}

export function ClientDrawer({
  clientId,
  isOpen,
  onClose,
  onArchive,
  onDelete,
  onViewClient,
}: ClientDrawerProps) {
  const { data: client, isLoading } = useClient(clientId || undefined)
  const updateClient = useUpdateClient()
  const { toast } = useToast()

  const handleUpdate = async (updates: Partial<ClientWithRelations>) => {
    if (!client?.clientId) return

    try {
      await updateClient.mutateAsync({
        clientId: client.clientId,
        updates,
      })
      toast({
        title: 'Client mis a jour',
        description: 'Les modifications ont ete enregistrees.',
      })
    } catch (error) {
      console.error('Failed to update client:', error)
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre a jour le client.',
        variant: 'error',
      })
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-0"
      >
        <VisuallyHidden>
          <SheetTitle>
            {client ? `${client.firstName} ${client.lastName}` : 'Details du client'}
          </SheetTitle>
          <SheetDescription>
            Fiche detaillee du client
          </SheetDescription>
        </VisuallyHidden>
        {isLoading ? (
          <DrawerSkeleton />
        ) : client ? (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-6 border-b border-border">
              <DrawerHeader client={client} />
            </div>

            {/* Accordion sections */}
            <div className="flex-1 overflow-y-auto p-6">
              <Accordion
                type="multiple"
                defaultValue={['info']}
                className="space-y-2"
              >
                <InfoSection client={client} onUpdate={handleUpdate} />
                <ExternalPayersSection client={client} />
                <RelationsSection client={client} onViewClient={onViewClient} />
                <VisitsSection client={client} />
                <NotesSection client={client} />
                <ConsentsSection client={client} />
                <HistorySection client={client} />
              </Accordion>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border bg-background-secondary">
              <DrawerFooter
                client={client}
                onArchive={onArchive ? () => onArchive(client.clientId) : undefined}
                onDelete={onDelete ? () => onDelete(client.clientId) : undefined}
              />
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-foreground-secondary">
            Client non trouve
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DrawerSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-start gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      </div>

      {/* Content skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
