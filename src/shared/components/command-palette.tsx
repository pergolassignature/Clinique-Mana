import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  UserCircle,
  Inbox,
  BarChart3,
  Settings,
  Search,
} from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import {
  Dialog,
  DialogContent,
} from '@/shared/ui/dialog'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const navCommands = [
  { path: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/professionnels', label: 'nav.professionals', icon: Users },
  { path: '/disponibilites', label: 'nav.availability', icon: Calendar },
  { path: '/motifs', label: 'nav.reasons', icon: FileText },
  { path: '/clients', label: 'nav.clients', icon: UserCircle },
  { path: '/demandes', label: 'nav.requests', icon: Inbox },
  { path: '/rapports', label: 'nav.reports', icon: BarChart3 },
  { path: '/parametres', label: 'nav.settings', icon: Settings },
] as const

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filteredCommands = useMemo(() => {
    if (!query) return navCommands

    const lowerQuery = query.toLowerCase()
    return navCommands.filter((cmd) => {
      const label = t(cmd.label as Parameters<typeof t>[0]).toLowerCase()
      return label.includes(lowerQuery) || cmd.path.includes(lowerQuery)
    })
  }, [query])

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) =>
            i < filteredCommands.length - 1 ? i + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter': {
          e.preventDefault()
          const selected = filteredCommands[selectedIndex]
          if (selected) {
            navigate({ to: selected.path })
            onOpenChange(false)
          }
          break
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredCommands, selectedIndex, navigate, onOpenChange])

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleSelect = (path: string) => {
    navigate({ to: path })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center border-b border-border px-4">
          <Search className="h-5 w-5 text-foreground-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('commandPalette.placeholder')}
            className="flex-1 border-0 bg-transparent py-4 px-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-0"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-background-secondary px-1.5 font-mono text-xs text-foreground-muted">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-foreground-muted">
                {t('commandPalette.noResults')}
              </p>
            </div>
          ) : (
            <>
              <p className="px-2 py-1.5 text-xs font-medium text-foreground-muted">
                {t('commandPalette.navigation')}
              </p>
              <ul>
                {filteredCommands.map((cmd, index) => {
                  const Icon = cmd.icon
                  const label = t(cmd.label as Parameters<typeof t>[0])
                  const isSelected = index === selectedIndex

                  return (
                    <li key={cmd.path}>
                      <button
                        onClick={() => handleSelect(cmd.path)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                          isSelected
                            ? 'bg-sage-100 text-sage-700'
                            : 'text-foreground hover:bg-background-secondary'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isSelected
                              ? 'text-sage-600'
                              : 'text-foreground-muted'
                          )}
                        />
                        <span className="flex-1">{label}</span>
                        {isSelected && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-xs text-sage-500"
                          >
                            ↵
                          </motion.span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-foreground-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background-secondary px-1">↑</kbd>
              <kbd className="rounded border border-border bg-background-secondary px-1">↓</kbd>
              pour naviguer
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background-secondary px-1">↵</kbd>
              pour sélectionner
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
