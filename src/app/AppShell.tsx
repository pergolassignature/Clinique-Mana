import { useState, type MouseEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LogOut, type LucideIcon } from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { useReadyAccess } from '@/core/access/access-context'
import { cn } from '@/shared/lib/utils'

export interface ShellNavItem {
  /** Absolute link target, e.g. '/professionnels'. */
  path: string
  labelKey: TranslationKey
  icon: LucideIcon
}

const MAIN_ID = 'contenu'

/** Deliberately minimal: the visual redesign is its own task. */
export function AppShell({ navItems, children }: { navItems: ShellNavItem[]; children: ReactNode }) {
  const { signOut } = useAuth()
  const { org_name, display_name } = useReadyAccess()
  const [signingOut, setSigningOut] = useState(false)

  // signOut() always forgets this device's session. RequireAuth then sends this tab to plain
  // /connexion, and AccessProvider clears the query cache: no navigation here.
  const handleSignOut = () => {
    setSigningOut(true)
    void signOut()
  }

  // Focus the main region directly: a plain #hash change would also reach the router.
  const skipToContent = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(MAIN_ID)?.focus()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:shadow-medium"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="flex shrink-0 flex-col border-b border-border bg-card md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="px-5 py-4 text-lg font-semibold text-foreground">{org_name || t('app.name')}</div>
        <nav aria-label={t('nav.label')} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm',
                  isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted',
                )
              }
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 md:block md:p-3">
          <p className="truncate px-3 text-sm font-medium text-foreground" title={display_name}>
            {display_name}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50 md:mt-2 md:w-full"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('nav.logout')}
          </button>
        </div>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-8">
        {children}
      </main>
    </div>
  )
}
