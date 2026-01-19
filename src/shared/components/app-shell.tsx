import { useState, useEffect } from 'react'
import { Outlet } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Sidebar } from './sidebar'
import { TopBar } from './topbar'
import { CommandPalette } from './command-palette'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { Toaster } from '@/shared/ui/toaster'

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Handle keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-full bg-background">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileMenuOpen(false)}
              />

              {/* Sidebar Drawer */}
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="fixed inset-y-0 left-0 z-50 lg:hidden"
              >
                <div className="relative h-full">
                  <Sidebar
                    collapsed={false}
                    onToggle={() => {}}
                    onClose={() => setMobileMenuOpen(false)}
                    isMobile
                  />
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="absolute top-4 -right-12 rounded-full bg-background p-2 shadow-medium"
                  >
                    <X className="h-5 w-5 text-foreground" />
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            onMenuClick={() => setMobileMenuOpen(true)}
            onSearchClick={() => setCommandPaletteOpen(true)}
            showMenuButton
          />

          <main className="flex-1 overflow-y-auto bg-background">
            <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
              <Outlet />
            </div>
          </main>
        </div>

        {/* Command Palette */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
        />

        {/* Toast Notifications */}
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
