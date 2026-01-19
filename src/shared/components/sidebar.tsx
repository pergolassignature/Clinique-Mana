import { Link, useRouterState, useNavigate } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  UserCircle,
  Inbox,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Briefcase,
} from 'lucide-react'
import { Logo, LogoMark } from '@/assets/logo'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'
import { Button } from '@/shared/ui/button'
import { useAuth } from '@/auth'
import type { UserRole } from '@/auth'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onClose?: () => void
  isMobile?: boolean
}

function getRoleBadgeLabel(role: UserRole): string {
  return role === 'provider' ? t('roles.professional') : t('roles.clinic')
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const navItems = [
  { path: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/demandes', label: 'nav.requests', icon: Inbox },
  { path: '/clients', label: 'nav.clients', icon: UserCircle },
  { path: '/professionnels', label: 'nav.professionals', icon: Users },
  { path: '/disponibilites', label: 'nav.availability', icon: Calendar },
  { path: '/motifs', label: 'nav.reasons', icon: FileText },
  { path: '/services', label: 'nav.services', icon: Briefcase },
  { path: '/rapports', label: 'nav.reports', icon: BarChart3 },
  { path: '/parametres', label: 'nav.settings', icon: Settings },
] as const

export function Sidebar({
  collapsed,
  onToggle,
  onClose,
  isMobile,
}: SidebarProps) {
  const routerState = useRouterState()
  const navigate = useNavigate()
  const { profile, isLoading, signOut } = useAuth()
  const currentPath = routerState.location.pathname

  const sidebarWidth = collapsed ? 'w-[72px]' : 'w-[260px]'

  const handleNavClick = () => {
    if (isMobile && onClose) {
      onClose()
    }
  }

  const handleLogout = async () => {
    await signOut()
    navigate({ to: '/connexion', search: { redirect: undefined } })
  }

  const displayName = profile?.display_name || ''
  const initials = displayName ? getInitials(displayName) : '?'
  const roleBadge = profile?.role ? getRoleBadgeLabel(profile.role) : ''

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'flex h-full flex-col border-r border-border bg-background-secondary',
        sidebarWidth
      )}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-3 border-b border-border">
        <AnimatePresence mode="wait">
          {collapsed ? (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="flex w-full justify-center"
            >
              <LogoMark />
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="flex-1"
            >
              <Logo />
            </motion.div>
          )}
        </AnimatePresence>

        {!isMobile && !collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="h-8 w-8 shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('nav.collapse')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Expand button when collapsed - positioned at bottom of nav */}
      {!isMobile && collapsed && (
        <div className="px-3 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="h-10 w-full"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('nav.expand')}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-hide">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = currentPath === item.path
            const Icon = item.icon
            const label = t(item.label as Parameters<typeof t>[0])

            const linkContent = (
              <Link
                to={item.path}
                onClick={handleNavClick}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-sage-100 text-sage-700'
                    : 'text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5 shrink-0 transition-colors',
                    isActive ? 'text-sage-600' : 'text-foreground-muted group-hover:text-foreground-secondary'
                  )}
                />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.15 }}
                      className="whitespace-nowrap overflow-hidden"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId="activeIndicator"
                    className="absolute left-0 h-8 w-1 rounded-r-full bg-sage-500"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </Link>
            )

            if (collapsed) {
              return (
                <li key={item.path} className="relative">
                  <Tooltip>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                </li>
              )
            }

            return (
              <li key={item.path} className="relative">
                {linkContent}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer - User Card */}
      <div className="border-t border-border p-3">
        {isLoading ? (
          // Loading skeleton
          <div
            className={cn(
              'flex items-center gap-3 rounded-xl p-2',
              collapsed && 'justify-center'
            )}
          >
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            {!collapsed && (
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            )}
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-background-tertiary',
              collapsed && 'justify-center'
            )}
          >
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex-1 overflow-hidden"
                >
                  <p className="text-sm font-medium text-foreground truncate">
                    {displayName}
                  </p>
                  {roleBadge && (
                    <Badge variant="secondary" className="mt-0.5">
                      {roleBadge}
                    </Badge>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Logout button */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                disabled={isLoading}
                className="mt-2 w-full text-foreground-muted hover:text-wine-600"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('nav.logout')}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            onClick={handleLogout}
            disabled={isLoading}
            className="mt-2 w-full justify-start gap-3 text-foreground-muted hover:text-wine-600 hover:bg-wine-50"
          >
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </Button>
        )}
      </div>
    </motion.aside>
  )
}
