import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedAddress {
  streetNumber: string | null
  streetName: string | null
  city: string | null
  province: string | null
  country: string
  postalCode: string | null
}

export interface PlaceSuggestion {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

interface UseGooglePlacesOptions {
  onPlaceSelect?: (place: ParsedAddress, fullAddress: string) => void
}

// =============================================================================
// HOOK
// =============================================================================

export function useGooglePlaces(options: UseGooglePlacesOptions = {}) {
  const { onPlaceSelect } = options

  const inputRef = useRef<HTMLInputElement>(null)
  const [isLoaded] = useState(true) // Always ready with Edge Functions
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const onPlaceSelectRef = useRef(onPlaceSelect)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep callback ref updated
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect
  }, [onPlaceSelect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Fetch suggestions via Supabase Edge Function
  const fetchSuggestions = useCallback(async (input: string) => {
    if (!input.trim() || input.length < 3) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    setIsLoading(true)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('google-places-autocomplete', {
        body: { input },
      })

      if (fnError) {
        console.error('Edge function error:', fnError)
        setError(fnError.message)
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      if (data?.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions)
        setShowSuggestions(true)
      } else {
        setSuggestions([])
        setShowSuggestions(false)
      }
    } catch (err) {
      console.error('Error fetching suggestions:', err)
      setSuggestions([])
      setShowSuggestions(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle input change with debounce
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(value)
    }, 300)
  }, [fetchSuggestions])

  // Handle suggestion selection via Supabase Edge Function
  const handleSuggestionSelect = useCallback(async (suggestion: PlaceSuggestion) => {
    if (!suggestion.placeId) return

    setShowSuggestions(false)
    setInputValue(suggestion.description)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('google-places-details', {
        body: { placeId: suggestion.placeId },
      })

      if (fnError) {
        console.error('Edge function error:', fnError)
        return
      }

      if (data?.address) {
        onPlaceSelectRef.current?.(data.address, data.formattedAddress || suggestion.description)
      }
    } catch (err) {
      console.error('Error fetching place details:', err)
    }
  }, [])

  // Close suggestions when clicking outside
  const handleBlur = useCallback(() => {
    // Delay to allow click on suggestion
    setTimeout(() => {
      setShowSuggestions(false)
    }, 200)
  }, [])

  return {
    inputRef,
    isLoaded,
    error,
    suggestions,
    showSuggestions,
    inputValue,
    isLoading,
    handleInputChange,
    handleSuggestionSelect,
    handleBlur,
    setShowSuggestions,
  }
}
