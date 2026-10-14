import { Ban, Bell, BellOff, CircleCheck, CircleHelp, Phone, Repeat, TriangleAlert, type LucideIcon } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'

const G = 'modules.appointments.agenda.legend'

const ITEMS: { key: 'confirmed' | 'reminded' | 'unreachable' | 'phone' | 'outside' | 'series' | 'cancelled'; icon: LucideIcon; tone?: string }[] = [
  { key: 'confirmed', icon: CircleCheck },
  { key: 'reminded', icon: Bell },
  { key: 'unreachable', icon: BellOff, tone: 'text-warning' },
  { key: 'phone', icon: Phone },
  { key: 'outside', icon: TriangleAlert, tone: 'text-warning' },
  { key: 'series', icon: Repeat },
  { key: 'cancelled', icon: Ban },
]

/** « Légende » (AP-49): what the agenda blocks' small icons say, the client's confirmation and reminder first. */
export function AgendaLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <CircleHelp aria-hidden />
          {t(`${G}.open`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} aria-label={t(`${G}.title`)} className="w-80 p-3">
        <ul className="space-y-2 text-sm">
          {ITEMS.map(({ key, icon: Icon, tone }) => (
            <li key={key} className="flex items-start gap-2">
              <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', tone)} />
              <span>{t(`${G}.${key}`)}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
