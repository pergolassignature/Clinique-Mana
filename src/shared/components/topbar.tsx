import { useRouterState } from '@tanstack/react-router'
import { Search, Bell, HelpCircle, Menu, User, Settings, LogOut } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'

interface TopBarProps {
  onMenuClick?: () => void
  onSearchClick?: () => void
  showMenuButton?: boolean
}

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'pages.dashboard.title', subtitle: 'pages.dashboard.subtitle' },
  '/professionnels': { title: 'pages.professionals.title', subtitle: 'pages.professionals.subtitle' },
  '/disponibilites': { title: 'pages.availability.title', subtitle: 'pages.availability.subtitle' },
  '/motifs': { title: 'pages.reasons.title', subtitle: 'pages.reasons.subtitle' },
  '/clients': { title: 'pages.clients.title', subtitle: 'pages.clients.subtitle' },
  '/demandes': { title: 'pages.requests.title', subtitle: 'pages.requests.subtitle' },
  '/rapports': { title: 'pages.reports.title', subtitle: 'pages.reports.subtitle' },
  '/parametres': { title: 'pages.settings.title', subtitle: 'pages.settings.subtitle' },
}

export function TopBar({ onMenuClick, onSearchClick, showMenuButton }: TopBarProps) {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const pageInfo = pageTitles[currentPath] ?? pageTitles['/dashboard']!

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

      {/* Center - Search */}
      <div className="hidden md:flex flex-1 max-w-md mx-8">
        <button
          onClick={onSearchClick}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-background-secondary px-4 py-2 text-sm text-foreground-muted transition-colors hover:border-sage-300 hover:bg-background"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">{t('topbar.search')}</span>
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-xs text-foreground-muted">
            {t('topbar.searchHint')}
          </kbd>
        </button>
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-2">
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
              <Avatar className="h-8 w-8">
                <AvatarFallback>AD</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium text-foreground">Admin Demo</p>
                <p className="text-xs text-foreground-muted">admin@cliniquemana.ca</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              {t('topbar.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-wine-600">
              <LogOut className="mr-2 h-4 w-4" />
              {t('nav.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
