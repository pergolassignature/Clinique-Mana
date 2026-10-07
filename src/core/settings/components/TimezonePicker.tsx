import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { t } from '@/i18n'
import { CANADIAN_TIMEZONES, isCanadianTimezone, listTimezones, matchesTimezone, timezoneLabel } from '@/core/settings/organization/timezones'
import { Button } from '@/shared/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'

interface TimezonePickerProps {
  /** The zone currently in the form: highlighted first and marked « (fuseau actuel) ». */
  value: string
  onSelect: (zone: string) => void
}

/** The picker's filter: the item's value is the zone; matches its French name or identifier. */
const filterZones = (zone: string, search: string) => (matchesTimezone(zone, search) ? 1 : 0)

/**
 * « Autre fuseau… »: a button opening a searchable list of every zone the browser knows (the
 * Canadian ones first, by French name). Choosing one hands it to `onSelect` and closes; Radix then
 * returns focus to the button. A button, so it does not inherit read-only: the page hides it.
 */
export function TimezonePicker({ value, onSelect }: TimezonePickerProps) {
  const [open, setOpen] = useState(false)
  // Once per mount: ~420 zones, sorted.
  const others = useMemo(() => listTimezones().filter((zone) => !isCanadianTimezone(zone)), [])

  const item = (zone: string) => (
    <CommandItem
      key={zone}
      value={zone}
      onSelect={() => {
        onSelect(zone)
        setOpen(false)
      }}
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
      <DialogContent aria-describedby={undefined} className="max-w-[480px] gap-0 overflow-hidden p-0">
        <DialogTitle className="px-4 pb-3 pr-10 pt-4 text-base">{t('settings.region.picker.title')}</DialogTitle>
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
