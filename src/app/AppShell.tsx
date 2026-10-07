import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/shared/ui/sheet'
import { CommandPalette, type PalettePage } from './shell/CommandPalette'
import { ACCOUNT_PAGE, resolveShellTitle, type ShellNavItem } from './shell/shell-pages'
import { SidebarContent } from './shell/SidebarContent'
import { Topbar } from './shell/Topbar'
import { useSidebarCollapsed } from './shell/use-sidebar-collapsed'

export type { ShellNavItem, ShellPage } from './shell/shell-pages'

const MAIN_ID = 'contenu'

/**
 * The signed-in layout (design system « Ossature »): sidebar 220 px (56 collapsed, remembered),
 * a 48 px topbar with the breadcrumb, ⌘K page search and the user menu, and the page (padding 24,
 * content max 1120). Below md the sidebar becomes a sheet opened from the topbar.
 * Every way of leaving the page goes through the unsaved-changes guard (Task 2.3).
 */
export function AppShell({ navItems, children }: { navItems: ShellNavItem[]; children: ReactNode }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const confirmLeave = useConfirmLeave()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // signOut() always forgets this device's session (decision #13). RequireAuth then sends this tab
  // to plain /connexion (#17), and AccessProvider clears the query cache (#10): no navigation here.
  const handleSignOut = useCallback(() => {
    if (signingOut) return
    setSigningOut(true)
    void signOut()
  }, [signingOut, signOut])

  const goTo = useCallback(
    (path: string) => {
      // Like GuardedNavLink: the current page is not left, so nothing to confirm or push.
      if (path === pathname) return
      confirmLeave(() => navigate(path))
    },
    [pathname, confirmLeave, navigate],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault() // Ctrl+K is the browser's search shortcut on Windows and Linux
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The sheet is the phone layout only: leaving it open while the window widens would leave its overlay.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const desktop = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    desktop.addEventListener('change', onChange)
    return () => desktop.removeEventListener('change', onChange)
  }, [])

  const title = useMemo(() => resolveShellTitle(pathname, navItems), [pathname, navItems])
  const palettePages = useMemo<PalettePage[]>(() => [...navItems, { ...ACCOUNT_PAGE, icon: UserRound }], [navItems])

  // Radix would focus the first tabbable element, skipping links: the footer's « Se déconnecter »,
  // where one Enter signs out. Start on the current page's link instead (or the first one).
  const focusCurrentNavLink = (event: Event) => {
    const sheet = event.currentTarget
    if (!(sheet instanceof HTMLElement)) return
    const link = sheet.querySelector<HTMLElement>('nav a[aria-current="page"]') ?? sheet.querySelector<HTMLElement>('nav a')
    if (!link) return
    event.preventDefault()
    link.focus()
  }

  // Focus the main region directly: a plain #hash change would also reach the router.
  const skipToContent = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(MAIN_ID)?.focus()
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-link focus:shadow-focus"
      >
        {t('nav.skipToContent')}
      </a>

      <header
        data-collapsed={collapsed}
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar px-2 transition-[width] duration-160 motion-reduce:transition-none md:flex',
          collapsed ? 'w-14' : 'w-[220px]',
        )}
      >
        <SidebarContent navItems={navItems} collapsed={collapsed} signingOut={signingOut} onSignOut={handleSignOut} />
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={title}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenAccount={() => goTo(ACCOUNT_PAGE.path)}
          signingOut={signingOut}
          onSignOut={handleSignOut}
        />
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
          <div className="mx-auto flex w-full max-w-content flex-col gap-5">{children}</div>
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          onOpenAutoFocus={focusCurrentNavLink}
          className="w-[260px] max-w-[85vw] bg-sidebar px-2"
        >
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SidebarContent
            navItems={navItems}
            collapsed={false}
            signingOut={signingOut}
            onSignOut={handleSignOut}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        pages={palettePages}
        onSelect={(path) => {
          setPaletteOpen(false)
          goTo(path)
        }}
      />
    </div>
  )
}
