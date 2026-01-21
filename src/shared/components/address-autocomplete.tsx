import { MapPin, Loader2 } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { useGooglePlaces, type ParsedAddress } from '@/shared/hooks/use-google-places'
import { cn } from '@/shared/lib/utils'

interface AddressAutocompleteProps {
  onAddressSelect: (address: ParsedAddress, fullAddress: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function AddressAutocomplete({
  onAddressSelect,
  placeholder = 'Rechercher une adresse...',
  className,
  disabled,
}: AddressAutocompleteProps) {
  const {
    inputRef,
    isLoaded,
    error,
    suggestions,
    showSuggestions,
    inputValue,
    handleInputChange,
    handleSuggestionSelect,
    handleBlur,
  } = useGooglePlaces({
    onPlaceSelect: (parsed, fullAddress) => {
      onAddressSelect(parsed, fullAddress)
    },
  })

  const showLoader = !isLoaded && !error

  return (
    <div className={cn('relative', className)}>
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted z-10 pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled || !isLoaded}
        className="pl-9 pr-9"
        autoComplete="off"
      />
      {showLoader && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted animate-spin" />
      )}
      {error && (
        <p className="text-xs text-wine-600 mt-1">
          Autocompletion non disponible
        </p>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-background-secondary focus:bg-background-secondary focus:outline-none transition-colors"
              onMouseDown={(e) => {
                // Prevent blur from firing before click
                e.preventDefault()
              }}
              onClick={() => handleSuggestionSelect(suggestion)}
            >
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 text-foreground-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {suggestion.mainText}
                  </p>
                  <p className="text-xs text-foreground-muted truncate">
                    {suggestion.secondaryText}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
