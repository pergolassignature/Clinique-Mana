import type { RefObject } from 'react'
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
  /** Radix's close auto-focus, for the shell to send focus back where it was. */
  onCloseAutoFocus: (event: Event) => void
  contentRef: RefObject<HTMLDivElement | null>
}

/** Lower case, without accents: « paramètres », « PARAMETRES » and « parametres » are the same. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Matches on the label only (the item's value is its path, which people never type). */
const filterByLabel = (_value: string, search: string, keywords?: string[]) =>
  fold((keywords ?? []).join(' ')).includes(fold(search.trim())) ? 1 : 0

/**
 * ⌘K / Ctrl+K: go to a page by name (the legacy palette, inventory §D « Shared »). Navigation only:
 * one « Pages » group; record search (clients, professionals) comes with those modules.
 */
export function CommandPalette({ open, onOpenChange, pages, onSelect, onCloseAutoFocus, contentRef }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        hideClose
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className="max-w-[600px] gap-0 overflow-hidden rounded-lg border border-border p-0"
      >
        <DialogTitle className="sr-only">{t('nav.palette.title')}</DialogTitle>
        {/* No vim bindings: cmdk would take Ctrl+K (« up ») and the shortcut could not close the palette. */}
        <Command label={t('nav.palette.title')} loop filter={filterByLabel} vimBindings={false}>
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
