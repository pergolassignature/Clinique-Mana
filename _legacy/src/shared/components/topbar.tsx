import { useRouterState, useNavigate } from '@tanstack/react-router'
import { Search, Bell, HelpCircle, Menu, User, Settings, LogOut } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'
import { useAuth } from '@/auth'

interface TopBarProps {
  onMenuClick?: () => void
  onSearchClick?: () => void
  showMenuButton?: boolean
}

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'pages.dashboard.title', subtitle: 'pages.dashboard.subtitle' },
  '/professionnels': { title: 'pages.professionals.title', subtitle: 'pages.professionals.subtitle' },
  '/disponibilites': { title: 'pages.availability.title', subtitle: 'pages.availability.subtitle' },
  '/clients': { title: 'pages.clients.title', subtitle: 'pages.clients.subtitle' },
  '/demandes': { title: 'pages.requests.title', subtitle: 'pages.requests.subtitle' },
  '/rapports': { title: 'pages.reports.title', subtitle: 'pages.reports.subtitle' },
  '/parametres': { title: 'pages.settings.title', subtitle: 'pages.settings.subtitle' },
  '/parametres/motifs': { title: 'pages.settings.title', subtitle: 'pages.settings.motifs.subtitle' },
  '/parametres/services': { title: 'pages.settings.title', subtitle: 'pages.settings.services.subtitle' },
}

function getPageInfo(path: string): { title: string; subtitle: string } {
  // Exact match
  if (pageTitles[path]) {
    return pageTitles[path]
  }
  // Check for parent route match (e.g., /demandes/123 -> /demandes)
  const segments = path.split('/')
  while (segments.length > 1) {
    segments.pop()
    const parentPath = segments.join('/') || '/'
    if (pageTitles[parentPath]) {
      return pageTitles[parentPath]
    }
  }
  // Fallback to dashboard
  return pageTitles['/dashboard']!
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function TopBar({ onMenuClick, onSearchClick, showMenuButton }: TopBarProps) {
  const routerState = useRouterState()
  const navigate = useNavigate()
  const { profile, isLoading, signOut } = useAuth()
  const currentPath = routerState.location.pathname
  const pageInfo = getPageInfo(currentPath)

  const displayName = profile?.display_name || ''
  const initials = displayName ? getInitials(displayName) : '?'

  const handleLogout = async () => {
    await signOut()
    navigate({ to: '/connexion', search: { redirect: undefined } })
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 lg:px-6">
      {/* Left - Page Title */}
      <div className="flex items-center gap-4">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {t(pageInfo.title as Parameters<typeof t>[0])}
          </h1>
          <p className="text-sm text-foreground-muted hidden sm:block">
            {t(pageInfo.subtitle as Parameters<typeof t>[0])}
          </p>
        </div>
      </div>

      {/* Right - Search + Actions */}
      <div className="flex items-center gap-2">
        {/* Search bar - desktop */}
        <button
          onClick={onSearchClick}
          className="hidden md:flex items-center gap-2 rounded-xl border border-border bg-background-secondary px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:border-sage-300 hover:bg-background"
        >
          <Search className="h-4 w-4" />
          <span>{t('topbar.search')}</span>
          <kbd className="hidden lg:inline-flex h-5 items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-xs text-foreground-muted">
            {t('topbar.searchHint')}
          </kbd>
        </button>

        {/* Mobile search button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onSearchClick}
          className="md:hidden"
        >
          <Search className="h-5 w-5" />
        </Button>

        {/* Notifications */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {/* Notification dot */}
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-wine-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('topbar.notifications')}</TooltipContent>
        </Tooltip>

        {/* Help */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <HelpCircle className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('topbar.help')}</TooltipContent>
        </Tooltip>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              {isLoading ? (
                <Skeleton className="h-8 w-8 rounded-full" />
              ) : (
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-48 z-50">
            <DropdownMenuItem onClick={() => navigate({ to: '/parametres' })}>
              <User className="mr-2 h-4 w-4" />
              {t('topbar.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: '/parametres' })}>
              <Settings className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-wine-600 focus:text-wine-600 focus:bg-wine-50"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
