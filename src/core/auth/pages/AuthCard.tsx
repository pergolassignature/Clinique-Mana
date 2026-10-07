import type { ReactNode } from 'react'
import { t } from '@/i18n'

/** Centered card shared by the sign-in, forgotten-password and reset pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">{t('app.name')}</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  )
}
