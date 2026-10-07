import { useState } from 'react'
import { User, Pencil } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { ClientWithRelations } from '../types'
import { EditTagsDialog } from './drawer-sections/edit-dialogs'
import { useClientTags } from '../hooks'

interface DrawerHeaderProps {
  client: ClientWithRelations
  onUpdateTags?: (tags: string[]) => void
}

export function DrawerHeader({ client, onUpdateTags }: DrawerHeaderProps) {
  const [editTagsOpen, setEditTagsOpen] = useState(false)
  const { data: availableTags = [] } = useClientTags()
  const initials = `${client.firstName[0]}${client.lastName[0]}`.toUpperCase()

  const formatBalance = (balanceCents: number | undefined) => {
    if (balanceCents === undefined) return '0,00 $'
    const dollars = balanceCents / 100
    return `${dollars.toFixed(2).replace('.', ',')} $`
  }

  const handleSaveTags = (tags: string[]) => {
    console.log('Save tags:', tags)
    onUpdateTags?.(tags)
  }

  return (
    <>
      <div className="space-y-4">
        {/* Profile row */}
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <Avatar className="h-16 w-16 border-2 border-border">
            <AvatarFallback className="bg-sage-100 text-sage-700 text-lg font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Name */}
            <h2 className="text-xl font-semibold text-foreground truncate">
              {client.firstName} {client.lastName}
            </h2>

            {/* Client ID */}
            <div className="flex items-center gap-2 text-sm text-foreground-secondary">
              <span className="font-mono">{client.clientId}</span>
            </div>

            {/* Status + Balance */}
            <div className="flex items-center gap-3 mt-2">
              <Badge
                variant={client.isArchived ? 'secondary' : 'default'}
                className={cn(
                  client.isArchived
                    ? 'bg-background-tertiary text-foreground-secondary'
                    : 'bg-sage-100 text-sage-700'
                )}
              >
                {t(`clients.status.${client.isArchived ? 'archived' : 'active'}`)}
              </Badge>

              <div className="flex items-center gap-1 text-sm">
                <span className="text-foreground-secondary">
                  {t('clients.drawer.visits.balance')}:
                </span>
                <span className="font-medium text-foreground">
                  {formatBalance(client.balanceCents)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-2 flex-1">
            {client.tags.length > 0 ? (
              client.tags.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-foreground-muted italic">Aucun tag</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditTagsOpen(true)}
            className="h-7 px-2 text-foreground-muted hover:text-foreground shrink-0"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Guardian link (for minors) */}
        {client.responsibleClient && (
          <div className="p-3 rounded-lg bg-honey-50 border border-honey-200">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-honey-600" />
              <span className="text-honey-800">
                Responsable: {client.responsibleClient.firstName} {client.responsibleClient.lastName}
                <span className="text-honey-600 ml-1">
                  ({client.responsibleClient.clientId})
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Edit Tags Dialog */}
      <EditTagsDialog
        client={client}
        open={editTagsOpen}
        onOpenChange={setEditTagsOpen}
        onSave={handleSaveTags}
        availableTags={availableTags}
      />
    </>
  )
}
