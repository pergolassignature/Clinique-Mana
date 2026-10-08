import type { MouseEvent } from 'react'
import { LogOut } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { useRoleLabel } from '@/core/users/hooks'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import type { ShellNavItem } from './shell-pages'
import { UserAvatar } from './UserAvatar'

interface SidebarContentProps {
  navItems: ShellNavItem[]
  /** 56 px: centred icons, labels for screen readers and the native tooltip only. */
  collapsed: boolean
  /** `sheet`: the phone menu, with 40 px touch targets; `sidebar`: the design system's desktop sizes. */
  variant: 'sidebar' | 'sheet'
  signingOut: boolean
  onSignOut: () => void
  /**
   * Runs before the link's own handling. Calling `event.preventDefault()` takes over the navigation
   * (the mobile sheet does, to close itself only once the unsaved-changes guard lets it leave).
   */
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}

/**
 * The sidebar's inside (design system SidebarNav): logo, main menu, and the signed-in user with a
 * sign-out button. Rendered in the desktop sidebar and in the mobile sheet.
 */
export function SidebarContent({ navItems, collapsed, variant, signingOut, onSignOut, onLinkClick }: SidebarContentProps) {
  const { org_name, display_name, role } = useReadyAccess()
  const roleText = useRoleLabel(role)
  const touch = variant === 'sheet'

  return (
    <>
      <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center' : 'px-2')}>
        {/* The wordmark says MANA; the clinic's name is read out instead of a description of the image.
            Larger than the design system's 22 px at Jonathan's request (the script wordmark was unreadable). */}
        <img src={logoUrl} alt="" width={81} height={36} className="block h-9 w-auto max-w-full object-contain" />
        <span className="sr-only">{org_name || t('app.name')}</span>
      </div>

      <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-1">
        {navItems.map((item) => {
          const label = t(item.labelKey)
          return (
            <GuardedNavLink
              key={item.path}
              to={item.path}
              onClick={onLinkClick && ((event) => onLinkClick(event, item.path))}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  `group flex items-center gap-2.5 rounded-md text-sm transition-colors duration-120 ${focusRing}`,
                  collapsed ? 'justify-center p-2' : touch ? 'min-h-10 px-2 py-2.5' : 'px-2 py-1.5',
                  isActive
                    ? 'bg-card font-medium text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-ink/5 hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0 text-subtle group-aria-[current=page]:text-foreground" aria-hidden />
              <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
            </GuardedNavLink>
          )
        })}
      </nav>

      <div className="shrink-0 pb-2.5 pt-2">
        <div
          className={cn('flex items-center gap-2 px-2 py-1.5', collapsed && 'justify-center')}
          title={collapsed ? `${display_name} · ${roleText}` : undefined}
        >
          <UserAvatar name={display_name} />
          {/* Collapsed: the name and role stay readable by screen readers; sign-out is in the topbar menu. */}
          <div className={collapsed ? 'sr-only' : 'min-w-0 flex-1'}>
            <p className="truncate text-sm font-medium text-foreground" title={display_name}>
              {display_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{roleText}</p>
          </div>
          {!collapsed && (
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              aria-label={t('nav.logout')}
              title={t('nav.logout')}
              className={cn(
                `flex shrink-0 items-center justify-center rounded-md text-subtle transition-colors duration-120 hover:bg-ink/5 hover:text-foreground ${focusRing} disabled:pointer-events-none disabled:opacity-50`,
                touch ? 'h-10 w-10' : 'p-1',
              )}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
