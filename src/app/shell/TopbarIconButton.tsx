import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'

/** Ghost icon button: 28 × 28 from md (design system Topbar), 40 × 40 touch target below. */
export function TopbarIconButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-120 hover:bg-muted hover:text-foreground md:h-7 md:w-7 ${focusRing}`,
        className,
      )}
      {...props}
    />
  )
}
