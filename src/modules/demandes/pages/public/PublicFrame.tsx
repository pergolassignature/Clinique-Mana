import type { ReactNode } from 'react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'

/** The public pages' frame (booking, cancel): the clinic's logo and the title, on the auth pages' surface. */
export function PublicFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="h-fit w-full max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-7">
        <img src={logoUrl} alt={t('app.name')} width={99} height={44} className="mb-5 block h-11 w-auto" />
        <h1 tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {title}
        </h1>
        <div className="mt-5">{children}</div>
      </div>
    </main>
  )
}
