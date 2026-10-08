import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { ShellCrumbProvider } from '@/shared/lib/shell-crumb'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/shared/ui/sheet'
import { CommandPalette, type PalettePage } from './shell/CommandPalette'
import { isPaletteShortcut } from './shell/platform'
import { ACCOUNT_PAGE, resolveShellTitle, type ShellNavItem } from './shell/shell-pages'
import { SidebarContent } from './shell/SidebarContent'
import { Topbar } from './shell/Topbar'
import { useSidebarCollapsed } from './shell/use-sidebar-collapsed'

export type { ShellNavItem } from './shell/shell-pages'

const MAIN_ID = 'contenu'

/** The focused element, if it is a real one (not the page body). */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * Is a modal other than the palette and the sheet open (e.g. « Quitter sans enregistrer ? »)?
 * Our Dialog, AlertDialog and Sheet contents carry aria-modal="true"; a popover (role="dialog" too)
 * does not, so the palette may open over it. A modal closing (data-state="closed", exit
 * animation) no longer counts. The sheet is excluded because ⌘K from the sheet opens the palette.
 */
function otherModalOpen(...own: (HTMLElement | null)[]): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]:not([data-state="closed"])')).some(
    (modal) => !own.includes(modal),
  )
}

/** Clicks the browser handles itself (new tab or window): never taken over. */
const isNativeClick = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/**
 * The signed-in layout (design system « Ossature »): sidebar 220 px (56 collapsed, remembered),
 * a 48 px topbar (the banner) with the breadcrumb, ⌘K page search and the user menu, and the page
 * (padding 24, content max 1120, sections 20 apart). Below md the sidebar becomes a sheet opened
 * from the topbar. Every way out of the page — sidebar and breadcrumb links, the palette,
 * « Mon compte » and « Se déconnecter » — goes through the unsaved-changes guard (Task 2.3).
 * The palette and the sheet give focus back to where it was when they close. A detail page names
 * itself in the breadcrumb through `useShellCrumb` (ShellCrumbProvider).
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

  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const sheetReturnFocus = useRef<HTMLElement | null>(null)
  const paletteReturnFocus = useRef<HTMLElement | null>(null)
  // The palette's choice waits for the palette to close and give focus back (see onPaletteClosed).
  const palettePath = useRef<string | null>(null)
  // A ref, not the state: two clicks before the next render must still sign out once.
  const signingOutRef = useRef(false)

  // signOut() always forgets this device's session (decision #13). RequireAuth then sends this tab
  // to plain /connexion (#17), AccessProvider clears the query cache (#10), and signOut() finishes
  // with a full page load of /connexion: no navigation here.
  const signOutNow = useCallback(() => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    void signOut()
  }, [signOut])

  const handleSignOut = useCallback(() => {
    if (signingOutRef.current) return
    confirmLeave(signOutNow)
  }, [confirmLeave, signOutNow])

  const goTo = useCallback(
    (path: string) => {
      // Like GuardedNavLink: the current page is not left, so nothing to confirm or push.
      if (path === pathname) return
      confirmLeave(() => navigate(path))
    },
    [pathname, confirmLeave, navigate],
  )

  const openSheet = () => {
    sheetReturnFocus.current = focusedElement()
    setMobileOpen(true)
  }

  const openPalette = useCallback(() => {
    // From the sheet, focus goes back to what opened the sheet: the sheet itself is closing.
    paletteReturnFocus.current = sheetRef.current?.isConnected ? sheetReturnFocus.current : focusedElement()
    // A choice left over from a close event that never came must not navigate later.
    palettePath.current = null
    setMobileOpen(false)
    setPaletteOpen(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !isPaletteShortcut(event)) return
      const palette = paletteRef.current
      // Another modal dialog (e.g. « Quitter sans enregistrer ? ») has the floor: leave it alone.
      if (otherModalOpen(palette, sheetRef.current)) return
      event.preventDefault() // Ctrl+K is the browser's search shortcut on Windows and Linux
      if (palette?.isConnected) setPaletteOpen(false)
      else openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPalette])

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

  /** Radix would focus <body>: go back to the saved element if it is still there, else to the fallback. */
  const returnFocus = (event: Event, saved: RefObject<HTMLElement | null>, fallback: RefObject<HTMLElement | null>) => {
    event.preventDefault()
    const target = saved.current?.isConnected ? saved.current : fallback.current
    saved.current = null
    target?.focus()
  }

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

  const onSheetClosed = (event: Event) => {
    // Closed to open the palette: the palette has focus now.
    if (paletteRef.current?.isConnected) {
      event.preventDefault()
      return
    }
    returnFocus(event, sheetReturnFocus, menuButtonRef)
  }

  // The sheet closes only once the guard lets the page go: after « Rester » it stays open, with focus.
  const navigateFromSheet = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (isNativeClick(event)) return
    event.preventDefault()
    if (path === pathname) {
      setMobileOpen(false)
      return
    }
    confirmLeave(() => {
      setMobileOpen(false)
      navigate(path)
    })
  }

  const choosePalettePage = (path: string) => {
    // A focused element in the page being left will be gone: come back to the search button instead.
    if (path !== pathname && paletteReturnFocus.current?.closest(`#${MAIN_ID}`)) paletteReturnFocus.current = null
    palettePath.current = path
    setPaletteOpen(false)
  }

  // Focus first, then leave: the unsaved-changes dialog returns focus to it after « Rester ».
  const onPaletteClosed = (event: Event) => {
    returnFocus(event, paletteReturnFocus, searchButtonRef)
    const path = palettePath.current
    palettePath.current = null
    if (path) goTo(path)
  }

  // Focus the main region directly: a plain #hash change would also reach the router.
  const skipToContent = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(MAIN_ID)?.focus()
  }

  return (
    <ShellCrumbProvider>
      <div className="flex min-h-dvh bg-background">
        <a
          href={`#${MAIN_ID}`}
          onClick={skipToContent}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-link focus:shadow-focus"
        >
          {t('nav.skipToContent')}
        </a>

        <aside
          data-collapsed={collapsed}
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar px-2 transition-[width] duration-160 motion-reduce:transition-none md:flex',
            collapsed ? 'w-14' : 'w-[220px]',
          )}
        >
          <SidebarContent
            navItems={navItems}
            collapsed={collapsed}
            variant="sidebar"
            signingOut={signingOut}
            onSignOut={handleSignOut}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            title={title}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onOpenMenu={openSheet}
            onOpenPalette={openPalette}
            onOpenAccount={() => goTo(ACCOUNT_PAGE.path)}
            signingOut={signingOut}
            onSignOut={handleSignOut}
            menuButtonRef={menuButtonRef}
            searchButtonRef={searchButtonRef}
          />
          <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
            <div className="mx-auto flex w-full max-w-content flex-col gap-5">{children}</div>
          </main>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            ref={sheetRef}
            side="left"
            aria-describedby={undefined}
            onOpenAutoFocus={focusCurrentNavLink}
            onCloseAutoFocus={onSheetClosed}
            className="w-[260px] max-w-[85vw] bg-sidebar px-2"
          >
            <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
            <SidebarContent
              navItems={navItems}
              collapsed={false}
              variant="sheet"
              signingOut={signingOut}
              onSignOut={handleSignOut}
              onLinkClick={navigateFromSheet}
            />
          </SheetContent>
        </Sheet>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          pages={palettePages}
          onSelect={choosePalettePage}
          onCloseAutoFocus={onPaletteClosed}
          contentRef={paletteRef}
        />
      </div>
    </ShellCrumbProvider>
  )
}
