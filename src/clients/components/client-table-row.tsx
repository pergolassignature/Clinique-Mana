import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { t } from '@/i18n'
import { formatClinicDateShort, toClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import type { ClientListItem } from '../types'

interface ClientTableRowProps {
  client: ClientListItem
  visibleColumns: Set<string>
  onClick?: () => void
}

export function ClientTableRow({ client, visibleColumns, onClick }: ClientTableRowProps) {
  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return formatClinicDateShort(date)
  }

  const formatRelativeDate = (date: string | null) => {
    if (!date) return '—'
    return formatDistanceToNow(toClinicTime(date), { addSuffix: true, locale: fr })
  }

  const formatPhone = (phone: string | null) => {
    if (!phone) return '—'
    // Format: 514-555-0101
    return phone
  }

  return (
    <tr
      onClick={onClick}
      className={cn(
        'hover:bg-background-secondary transition-colors cursor-pointer',
        client.status === 'archived' && 'opacity-60'
      )}
    >
      {/* Client ID */}
      {visibleColumns.has('clientId') && (
        <td className="px-4 py-4 text-sm font-mono text-foreground-secondary">
          {client.clientId.replace('CLI-', '')}
        </td>
      )}

      {/* Name */}
      {visibleColumns.has('name') && (
        <td className="px-4 py-4">
          <span className="text-sm font-medium text-foreground">
            {client.lastName}, {client.firstName}
          </span>
        </td>
      )}

      {/* Birthday (DOB) */}
      {visibleColumns.has('birthday') && (
        <td className="px-4 py-4 text-sm text-foreground">
          {formatDate(client.birthday)}
        </td>
      )}

      {/* Email */}
      {visibleColumns.has('email') && (
        <td className="px-4 py-4 text-sm text-foreground-secondary">
          {client.email || '—'}
        </td>
      )}

      {/* Phone */}
      {visibleColumns.has('cellPhone') && (
        <td className="px-4 py-4 text-sm text-foreground-secondary">
          {formatPhone(client.cellPhone)}
        </td>
      )}

      {/* Last Appointment */}
      {visibleColumns.has('lastAppointment') && (
        <td className="px-4 py-4 text-sm text-foreground-secondary">
          {formatRelativeDate(client.lastAppointmentDateTime)}
        </td>
      )}

      {/* Status */}
      {visibleColumns.has('status') && (
        <td className="px-4 py-4">
          <Badge
            variant={client.status === 'active' ? 'default' : 'secondary'}
            className={cn(
              client.status === 'active'
                ? 'bg-sage-100 text-sage-700 hover:bg-sage-100'
                : 'bg-background-tertiary text-foreground-secondary hover:bg-background-tertiary'
            )}
          >
            {t(`clients.status.${client.status}`)}
          </Badge>
        </td>
      )}

      {/* Tags */}
      {visibleColumns.has('tags') && (
        <td className="px-4 py-4">
          <div className="flex flex-wrap gap-1">
            {client.tags.slice(0, 2).map(tag => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {client.tags.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{client.tags.length - 2}
              </Badge>
            )}
          </div>
        </td>
      )}

      {/* Primary Professional */}
      {visibleColumns.has('primaryProfessional') && (
        <td className="px-4 py-4 text-sm text-foreground-secondary">
          {client.primaryProfessionalName || '—'}
        </td>
      )}
    </tr>
  )
}
