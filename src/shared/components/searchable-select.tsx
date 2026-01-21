'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Search, Plus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/shared/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/ui/popover'

export interface SearchableSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  /** Filter options by custom fields (e.g., search by name, email, phone) */
  filterFn?: (option: SearchableSelectOption, searchQuery: string) => boolean
  /** Optional "Create New" action - shows a button at the bottom of the dropdown */
  onCreateNew?: () => void
  /** Label for the "Create New" button */
  createNewLabel?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Sélectionner...',
  searchPlaceholder = 'Rechercher...',
  emptyMessage = 'Aucun résultat.',
  disabled = false,
  className,
  filterFn,
  onCreateNew,
  createNewLabel = 'Créer nouveau',
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  const selectedOption = options.find((option) => option.value === value)

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options

    const query = searchQuery.toLowerCase()

    if (filterFn) {
      return options.filter((option) => filterFn(option, searchQuery))
    }

    return options.filter((option) => {
      const labelMatch = option.label.toLowerCase().includes(query)
      const descriptionMatch = option.description?.toLowerCase().includes(query)
      return labelMatch || descriptionMatch
    })
  }, [options, searchQuery, filterFn])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue === value ? '' : optionValue)
    setOpen(false)
    setSearchQuery('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !value && 'text-foreground-muted',
            className
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 text-foreground-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-foreground-muted disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <CommandList>
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-foreground-muted">
                {emptyMessage}
              </div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option.value)}
                    disabled={option.disabled}
                    className="cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-foreground-muted truncate">
                          {option.description}
                        </div>
                      )}
                    </div>
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4 shrink-0',
                        value === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {onCreateNew && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setSearchQuery('')
                  onCreateNew()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-sage-600 hover:bg-sage-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {createNewLabel}
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
