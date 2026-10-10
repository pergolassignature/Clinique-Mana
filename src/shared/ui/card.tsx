import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { InCardContext } from './card-context'

/**
 * White, 1px hairline, radius 6, no shadow. Padding 16 through header/content/footer. The title is
 * the « panel title » shared with dialogs and sheets: 16/24, 600 (audit 2026-10-09 §2.2).
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <InCardContext.Provider value>
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  </InCardContext.Provider>
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-0.5 p-4 pb-3', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** The heading level in the page's outline; `h3` by default (under the page's h1 and a section's h2). */
  as?: 'h2' | 'h3' | 'h4'
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(({ as: Tag = 'h3', className, ...props }, ref) => (
  <Tag
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs text-muted-foreground', className)}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
))
CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardTitle, CardDescription, CardContent }
