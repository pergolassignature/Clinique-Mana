import { useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { t } from '@/i18n'
import { CANADIAN_TIMEZONES, isCanadianTimezone, listTimezones, matchesTimezone, timezoneLabel } from '@/core/settings/organization/timezones'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'

interface TimezonePickerProps {
  /** The zone currently in the form: highlighted first and marked « (fuseau actuel) ». */
  value: string
  onSelect: (zone: string) => void
  /**
   * Runs once the dialog has closed after a choice, instead of Radix returning focus to « Autre
   * fuseau… »: the page focuses its select, so the new zone is announced. Échap still returns to the button.
   */
  onChosen?: () => void
}

/**
 * On phones the panel sits at the top, so the keyboard does not hide the list, and fades in (the
 * shared zoom animation keeps the vertical centring's translate); centred from `sm` up as usual.
 */
const PANEL_CLASSES =
  'max-w-[480px] gap-0 overflow-hidden p-0 top-4 translate-y-0 animate-fade-in sm:top-1/2 sm:-translate-y-1/2 sm:animate-dialog-in'

/** The picker's filter: the item's value is the zone; matches its French name or identifier. */
const filterZones = (zone: string, search: string) => (matchesTimezone(zone, search) ? 1 : 0)

/**
 * « Autre fuseau… »: a button opening a searchable list of every zone the browser knows (the
 * Canadian ones first, by French name). Choosing one hands it to `onSelect`, closes and calls
 * `onChosen`; closing without a choice returns focus to the button. A button, so it does not inherit
 * read-only: the page hides it.
 */
export function TimezonePicker({ value, onSelect, onChosen }: TimezonePickerProps) {
  const [open, setOpen] = useState(false)
  // Set by a choice, read when the dialog has closed (onCloseAutoFocus).
  const chosen = useRef(false)
  // Once per mount: ~420 zones, sorted.
  const others = useMemo(() => listTimezones().filter((zone) => !isCanadianTimezone(zone)), [])

  const item = (zone: string) => (
    <CommandItem
      key={zone}
      value={zone}
      onSelect={() => {
        chosen.current = true
        onSelect(zone)
        setOpen(false)
      }}
      className="min-h-11 sm:min-h-0"
    >
      {timezoneLabel(zone)}
      {zone === value && (
        <>
          <span className="sr-only"> {t('settings.region.picker.current')}</span>
          <Check className="ml-auto" aria-hidden />
        </>
      )}
    </CommandItem>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('settings.region.fields.other')}
        </Button>
      </DialogTrigger>
      <DialogContent
        hideClose
        className={PANEL_CLASSES}
        onCloseAutoFocus={(event) => {
          if (!chosen.current) return
          chosen.current = false
          if (onChosen) {
            event.preventDefault()
            onChosen()
          }
        }}
      >
        <DialogTitle className="px-4 pb-3 pr-10 pt-4 text-base">{t('settings.region.picker.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('settings.region.picker.currentDescription', { zone: timezoneLabel(value) })}</DialogDescription>
        {/* The shared close X, with a 44 px hit area on phones (an invisible ::after); out of the tab order. */}
        <DialogClose tabIndex={-1} className={cn(closeButtonClasses, 'after:absolute after:-inset-2.5 sm:after:hidden')}>
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogClose>
        <Command label={t('settings.region.picker.title')} loop filter={filterZones} defaultValue={value} vimBindings={false}>
          <CommandInput placeholder={t('settings.region.picker.placeholder')} />
          <CommandList className="h-[min(360px,60dvh)] max-h-none">
            <CommandEmpty>{t('settings.region.picker.empty')}</CommandEmpty>
            <CommandGroup heading={t('settings.region.picker.canada')}>{CANADIAN_TIMEZONES.map((zone) => item(zone.value))}</CommandGroup>
            {others.length > 0 && <CommandGroup heading={t('settings.region.picker.others')}>{others.map(item)}</CommandGroup>}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
