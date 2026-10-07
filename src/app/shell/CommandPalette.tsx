import type { LucideIcon } from 'lucide-react'
import { t } from '@/i18n'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import type { ShellPage } from './shell-pages'

export interface PalettePage extends ShellPage {
  icon: LucideIcon
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: PalettePage[]
  onSelect: (path: string) => void
}

/**
 * ⌘K / Ctrl+K: go to a page by name (the legacy palette, inventory §D « Shared »). Navigation only:
 * one « Pages » group; record search (clients, professionals) comes with those modules.
 */
export function CommandPalette({ open, onOpenChange, pages, onSelect }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="max-w-[600px] gap-0 overflow-hidden rounded-lg border border-border p-0"
      >
        <DialogTitle className="sr-only">{t('nav.palette.title')}</DialogTitle>
        <Command label={t('nav.palette.title')} loop>
          <CommandInput
            placeholder={t('nav.palette.placeholder')}
            trailing={
              <kbd className="hidden shrink-0 rounded-lg border border-border px-[5px] font-sans text-xs text-muted-foreground sm:inline">
                {t('nav.palette.escape')}
              </kbd>
            }
          />
          <CommandList>
            <CommandEmpty>{t('nav.palette.empty')}</CommandEmpty>
            <CommandGroup heading={t('nav.palette.pages')}>
              {pages.map((page) => {
                const label = t(page.labelKey)
                return (
                  // The value is the path (unique); the label is what people type.
                  <CommandItem key={page.path} value={page.path} keywords={[label]} onSelect={() => onSelect(page.path)}>
                    <page.icon aria-hidden />
                    {label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
