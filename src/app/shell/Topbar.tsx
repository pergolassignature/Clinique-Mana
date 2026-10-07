import type { ButtonHTMLAttributes } from 'react'
import { LogOut, PanelLeft, Search, UserRound } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { cn } from '@/shared/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { focusRing } from '@/shared/ui/field-classes'
import type { ShellTitle } from './shell-pages'
import { UserAvatar } from './UserAvatar'

/** The palette shortcut as this keyboard writes it. */
const SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'

/** 28 × 28 ghost icon button (design system Topbar). */
function TopbarIconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-120 hover:bg-muted hover:text-foreground ${focusRing}`,
        className,
      )}
      {...props}
    />
  )
}

interface TopbarProps {
  title: ShellTitle | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenMenu: () => void
  onOpenPalette: () => void
  onOpenAccount: () => void
  signingOut: boolean
  onSignOut: () => void
}

/** 48 px bar above the page: sidebar toggle, breadcrumb and title; page search and the user menu. */
export function Topbar({
  title,
  collapsed,
  onToggleCollapsed,
  onOpenMenu,
  onOpenPalette,
  onOpenAccount,
  signingOut,
  onSignOut,
}: TopbarProps) {
  const { display_name, role } = useReadyAccess()

  return (
    <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Below md the sidebar is a sheet: the same icon opens it. */}
        <TopbarIconButton className="md:hidden" aria-label={t('nav.openMenu')} aria-haspopup="dialog" onClick={onOpenMenu}>
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
              {title.parent && (
                <li className="flex shrink-0 items-center gap-2">
                  <GuardedNavLink
                    to={title.parent.path}
                    end
                    className={`rounded-sm text-muted-foreground transition-colors duration-120 hover:text-foreground ${focusRing}`}
                  >
                    {t(title.parent.labelKey)}
                  </GuardedNavLink>
                  <span className="text-subtle" aria-hidden>
                    /
                  </span>
                </li>
              )}
              <li className="min-w-0">
                <span aria-current="page" className="block truncate font-medium text-foreground">
                  {t(title.current.labelKey)}
                </span>
              </li>
            </ol>
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t('nav.searchLabel')}
          aria-keyshortcuts="Control+K Meta+K"
          aria-haspopup="dialog"
          className={`flex h-7 w-7 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm text-subtle transition-colors duration-120 hover:border-border-strong sm:w-auto sm:min-w-[200px] sm:justify-start sm:pl-2 sm:pr-1.5 ${focusRing}`}
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="hidden flex-1 text-left sm:inline">{t('nav.search')}</span>
          <kbd className="hidden rounded-md bg-muted px-1 py-px font-sans text-2xs text-muted-foreground sm:inline">
            {SHORTCUT_LABEL}
          </kbd>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t('nav.userMenu')} className={`flex shrink-0 rounded-full ${focusRing}`}>
              <UserAvatar name={display_name} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-sm">
              <span className="block truncate font-medium text-foreground">{display_name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{roleLabel(role)}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenAccount}>
              <UserRound className="text-subtle" aria-hidden />
              {t('nav.account')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signingOut} onSelect={onSignOut}>
              <LogOut className="text-subtle" aria-hidden />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
