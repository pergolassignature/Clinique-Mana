import { useRef, type RefObject } from 'react'
import { LogOut, PanelLeft, Search, UserRound } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { useRoleLabel } from '@/core/access/org-roles'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { useShellCrumbLabel } from '@/shared/lib/shell-crumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { focusRing } from '@/shared/ui/field-classes'
import { NotificationBell } from './NotificationBell'
import { isApplePlatform, paletteShortcutLabel } from './platform'
import type { ShellPage, ShellTitle } from './shell-pages'
import { TopbarIconButton } from './TopbarIconButton'
import { UserAvatar } from './UserAvatar'

interface TopbarProps {
  title: ShellTitle | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenMenu: () => void
  onOpenPalette: () => void
  onOpenAccount: () => void
  signingOut: boolean
  onSignOut: () => void
  /** Where focus goes back when the mobile sheet closes and its opener is gone. */
  menuButtonRef: RefObject<HTMLButtonElement | null>
  /** Same for the palette. */
  searchButtonRef: RefObject<HTMLButtonElement | null>
}

/** A breadcrumb step before the last one: a guarded link, then the separator. */
function CrumbLink({ page }: { page: ShellPage }) {
  return (
    <li className="flex shrink-0 items-center gap-2">
      <GuardedNavLink
        to={page.path}
        end
        className={`rounded-sm text-muted-foreground transition-colors duration-120 hover:text-foreground ${focusRing}`}
      >
        {t(page.labelKey)}
      </GuardedNavLink>
      <span className="text-subtle" aria-hidden>
        /
      </span>
    </li>
  )
}

/**
 * The page's banner, 48 px: sidebar toggle, breadcrumb and title; page search, the notification
 * bell and the user menu. A detail page adds its own last crumb (`useShellCrumb`): the nav page
 * before it becomes a link back.
 */
export function Topbar({
  title,
  collapsed,
  onToggleCollapsed,
  onOpenMenu,
  onOpenPalette,
  onOpenAccount,
  signingOut,
  onSignOut,
  menuButtonRef,
  searchButtonRef,
}: TopbarProps) {
  const { display_name, role } = useReadyAccess()
  const roleText = useRoleLabel(role)
  const crumb = useShellCrumbLabel()
  const avatarButtonRef = useRef<HTMLButtonElement>(null)
  // A menu action runs once the menu has closed and focus is back on the avatar, so the
  // unsaved-changes dialog it may open returns focus there after « Rester ».
  const pendingAction = useRef<(() => void) | null>(null)

  const runAfterClose = (event: Event) => {
    const action = pendingAction.current
    pendingAction.current = null
    if (!action) return
    event.preventDefault()
    avatarButtonRef.current?.focus()
    action()
  }

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Below md the sidebar is a sheet: the same icon opens it. */}
        <TopbarIconButton
          ref={menuButtonRef}
          className="-ml-2 md:hidden"
          aria-label={t('nav.openMenu')}
          aria-haspopup="dialog"
          onClick={onOpenMenu}
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </TopbarIconButton>
        <TopbarIconButton
          className="hidden md:inline-flex"
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          onClick={onToggleCollapsed}
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </TopbarIconButton>

        {title && (
          <nav aria-label={t('nav.breadcrumb')} className="min-w-0">
            <ol className="flex min-w-0 items-center gap-2 text-sm">
              {title.parent && <CrumbLink page={title.parent} />}
              {crumb !== null && <CrumbLink page={title.current} />}
              <li className="min-w-0">
                <span aria-current="page" className="block truncate font-medium text-foreground">
                  {crumb ?? t(title.current.labelKey)}
                </span>
              </li>
            </ol>
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          ref={searchButtonRef}
          type="button"
          onClick={onOpenPalette}
          aria-label={t('nav.searchLabel')}
          aria-keyshortcuts={isApplePlatform() ? 'Meta+K' : 'Control+K'}
          aria-haspopup="dialog"
          className={`flex h-10 w-10 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm text-subtle transition-colors duration-120 hover:border-border-strong sm:w-auto sm:min-w-[200px] sm:justify-start sm:pl-2 sm:pr-1.5 md:h-7 ${focusRing}`}
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="hidden flex-1 text-left sm:inline">{t('nav.search')}</span>
          <kbd className="hidden rounded-md bg-muted px-1 py-px font-sans text-2xs text-muted-foreground sm:inline">
            {paletteShortcutLabel()}
          </kbd>
        </button>

        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={avatarButtonRef}
              type="button"
              aria-label={t('nav.userMenu', { name: display_name })}
              className={`-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full md:mr-0 md:h-7 md:w-7 ${focusRing}`}
            >
              <UserAvatar name={display_name} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={runAfterClose}>
            <DropdownMenuLabel className="text-sm">
              <span className="block truncate font-medium text-foreground">{display_name}</span>
              <span className="block min-h-4 truncate text-xs font-normal text-muted-foreground">{roleText}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (pendingAction.current = onOpenAccount)}>
              <UserRound className="text-subtle" aria-hidden />
              {t('nav.account')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={() => (pendingAction.current = onSignOut)}>
              <LogOut className="text-subtle" aria-hidden />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
