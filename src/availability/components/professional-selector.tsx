// src/availability/components/professional-selector.tsx

import { useState, useMemo } from 'react'
import { Check, ChevronsUpDown, User } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/shared/ui/command'
import type { Professional } from '../types'

interface ProfessionalSelectorProps {
  selectedId: string | null
  onSelect: (id: string) => void
  professionals: Professional[]
}

export function ProfessionalSelector({
  selectedId,
  onSelect,
  professionals,
}: ProfessionalSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === selectedId),
    [professionals, selectedId]
  )

  const filteredProfessionals = useMemo(() => {
    if (!search.trim()) return professionals
    const query = search.toLowerCase()
    return professionals.filter((p) =>
      p.displayName.toLowerCase().includes(query)
    )
  }, [professionals, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[280px] justify-between"
        >
          <div className="flex items-center gap-2 truncate">
            <User className="h-4 w-4 text-foreground-muted shrink-0" />
            {selectedProfessional ? (
              <span className="truncate">{selectedProfessional.displayName}</span>
            ) : (
              <span className="text-foreground-muted">Sélectionner un professionnel...</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Rechercher..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Aucun professionnel trouvé.</CommandEmpty>
            <CommandGroup>
              {filteredProfessionals.map((professional) => (
                <CommandItem
                  key={professional.id}
                  value={professional.id}
                  onSelect={() => {
                    onSelect(professional.id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedId === professional.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {professional.displayName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
