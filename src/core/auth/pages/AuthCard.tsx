import type { ComponentProps, ReactNode, Ref } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

interface AuthCardProps {
  title: string
  subtitle?: string
  /**
   * Content of the card's live region (loading, "link sent"…). The region itself is always
   * mounted, at the same place in every state of a page, so screen readers announce changes.
   */
  status?: ReactNode
  children?: ReactNode
  /** Lets a page move focus to the heading (e.g. after its form is replaced by a message). */
  headingRef?: Ref<HTMLHeadingElement>
}

/** Centered card shared by the sign-in, forgotten-password and reset pages. */
export function AuthCard({ title, subtitle, status, children, headingRef }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-soft">
        <p className="text-sm font-medium text-muted-foreground">{t('app.name')}</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold text-foreground outline-none">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        <div role="status" aria-live="polite">
          {status}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </main>
  )
}

/** A short notice for the live region (e.g. "link sent"). */
export function StatusNotice({ muted = false, className, ...props }: ComponentProps<'p'> & { muted?: boolean }) {
  return (
    <p
      className={cn(
        'mt-6 text-sm outline-none',
        muted ? 'text-muted-foreground' : 'rounded-md bg-primary/10 px-3 py-2 text-foreground',
        className,
      )}
      {...props}
    />
  )
}
