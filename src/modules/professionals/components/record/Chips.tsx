import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import type { DigestItem } from '../../lib/matching-digest'

const M = 'modules.professionals.record.matching'

/** A list of quiet tags that wraps. */
export function ChipList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('flex flex-wrap gap-1.5', className)}>{children}</ul>
}

/**
 * A quiet tag: hairline border, secondary 12px text, no fill (design system: no pastel). One line
 * with an ellipsis by default; `wrap` lets a long name run onto a second line instead (a held
 * item is content: it is never cut).
 */
export function Chip({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <li className="inline-flex min-h-5 min-w-0 max-w-full items-center rounded-sm border border-border px-1.5 py-px text-xs text-muted-foreground">
      {/* `truncate` on the text, not the flex item: a flex container draws no ellipsis. */}
      <span className={wrap ? 'min-w-0 break-words' : 'min-w-0 truncate'}>{children}</span>
    </li>
  )
}

/** Held items as chips (★ specialised first, as `matchingDigest` orders them), or the empty line. */
export function HeldChips({ items, empty }: { items: readonly DigestItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ChipList>
      {items.map((item) => (
        <Chip key={item.id} wrap>
          {item.specialized && (
            <span aria-hidden className="text-warning-strong">
              ★{' '}
            </span>
          )}
          <span className="text-foreground">{item.label}</span>
          {item.specialized && <span className="sr-only"> {t(`${M}.specialized`)}</span>}
          {item.archived && <span> ({t(`${M}.archived`)})</span>}
        </Chip>
      ))}
    </ChipList>
  )
}
