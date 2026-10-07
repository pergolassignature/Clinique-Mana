import { LogOut } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { roleLabel } from '@/core/access/roles'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { cn } from '@/shared/lib/utils'
import { focusRing } from '@/shared/ui/field-classes'
import type { ShellNavItem } from './shell-pages'
import { UserAvatar } from './UserAvatar'

interface SidebarContentProps {
  navItems: ShellNavItem[]
  /** 56 px: centred icons, labels for screen readers and the native tooltip only. */
  collapsed: boolean
  signingOut: boolean
  onSignOut: () => void
  /** Called on every nav click (the mobile sheet closes itself with it). */
  onNavigate?: () => void
}

/**
 * The sidebar's inside (design system SidebarNav): logo, main menu, and the signed-in user with a
 * sign-out button. Rendered in the desktop sidebar and in the mobile sheet.
 */
export function SidebarContent({ navItems, collapsed, signingOut, onSignOut, onNavigate }: SidebarContentProps) {
  const { org_name, display_name, role } = useReadyAccess()
  const roleText = roleLabel(role)

  return (
    <>
      <div className={cn('flex h-12 shrink-0 items-center', collapsed ? 'justify-center' : 'px-2')}>
        {/* The wordmark says MANA; the clinic's name is read out instead of a description of the image. */}
        <img src={logoUrl} alt="" width={44} height={22} className="block h-[22px] w-auto max-w-full object-contain" />
        <span className="sr-only">{org_name || t('app.name')}</span>
      </div>

      <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-1">
        {navItems.map((item) => {
          const label = t(item.labelKey)
          return (
            <GuardedNavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  `group flex items-center gap-2.5 rounded-md text-sm transition-colors duration-120 ${focusRing}`,
                  collapsed ? 'justify-center p-2' : 'px-2 py-1.5',
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
              className={`flex shrink-0 rounded-md p-1 text-subtle transition-colors duration-120 hover:bg-ink/5 hover:text-foreground ${focusRing} disabled:pointer-events-none disabled:opacity-50`}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
