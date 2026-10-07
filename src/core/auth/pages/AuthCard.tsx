import type { ComponentProps, ReactNode, Ref } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import logoUrl from '@/assets/logo-header.svg'

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

/**
 * Centered card shared by the sign-in, forgotten-password and reset pages: white page, 360px
 * card with a hairline border, radius 6, padding 28; the MANA wordmark at 26px.
 */
export function AuthCard({ title, subtitle, status, children, headingRef }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-7">
        {/* The SVG's viewBox is 2:1, so 26px high is 52px wide. */}
        <img src={logoUrl} alt={t('app.name')} width={52} height={26} className="mb-5 block h-[26px] w-auto" />
        <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div role="status" aria-live="polite">
          {status}
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </main>
  )
}

/** A short notice for the live region (e.g. "link sent"): a bordered white box, or plain secondary text. */
export function StatusNotice({ muted = false, className, ...props }: ComponentProps<'p'> & { muted?: boolean }) {
  return (
    <p
      className={cn(
        'mt-4 text-sm outline-none',
        muted ? 'text-muted-foreground' : 'rounded-md border border-border bg-card px-2.5 py-2 text-foreground',
        className,
      )}
      {...props}
    />
  )
}
