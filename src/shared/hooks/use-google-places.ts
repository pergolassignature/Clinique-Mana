import { useEffect, useRef, useState, useCallback } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

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

// Province code mapping
const PROVINCE_CODES: Record<string, string> = {
  'Quebec': 'QC',
  'Québec': 'QC',
  'Ontario': 'ON',
  'British Columbia': 'BC',
  'Alberta': 'AB',
  'Manitoba': 'MB',
  'Saskatchewan': 'SK',
  'Nova Scotia': 'NS',
  'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL',
  'Prince Edward Island': 'PE',
  'Northwest Territories': 'NT',
  'Yukon': 'YT',
  'Nunavut': 'NU',
}

// =============================================================================
// GOOGLE MAPS LOADER (singleton)
// =============================================================================

let loadPromise: Promise<google.maps.PlacesLibrary> | null = null
let optionsSet = false

async function loadPlacesLibrary(): Promise<google.maps.PlacesLibrary> {
  if (loadPromise) return loadPromise

  const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    throw new Error('Google Places API key not found. Set VITE_GOOGLE_PLACES_API_KEY in your .env file.')
  }

  // Set options only once
  if (!optionsSet) {
    setOptions({
      key: apiKey,
      v: 'weekly',
      language: 'fr',
      region: 'CA',
    })
    optionsSet = true
  }

  loadPromise = importLibrary('places') as Promise<google.maps.PlacesLibrary>

  return loadPromise
}

// =============================================================================
// PARSE ADDRESS COMPONENTS (New API format)
// =============================================================================

function parseAddressComponents(
  components: google.maps.places.AddressComponent[]
): ParsedAddress {
  const result: ParsedAddress = {
    streetNumber: null,
    streetName: null,
    city: null,
    province: null,
    country: 'Canada',
    postalCode: null,
  }

  for (const component of components) {
    const types = component.types

    if (types.includes('street_number')) {
      result.streetNumber = component.longText || component.shortText || null
    } else if (types.includes('route')) {
      result.streetName = component.longText || component.shortText || null
    } else if (types.includes('locality') || types.includes('sublocality')) {
      result.city = component.longText || component.shortText || null
    } else if (types.includes('administrative_area_level_1')) {
      const provinceName = component.longText || ''
      result.province = PROVINCE_CODES[provinceName] || component.shortText || null
    } else if (types.includes('country')) {
      result.country = component.longText || 'Canada'
    } else if (types.includes('postal_code')) {
      result.postalCode = component.longText || component.shortText || null
    }
  }

  return result
}

// =============================================================================
// HOOK
// =============================================================================

export function useGooglePlaces(options: UseGooglePlacesOptions = {}) {
  const { onPlaceSelect } = options

  const inputRef = useRef<HTMLInputElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
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

  // Load Google Places Library
  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        await loadPlacesLibrary()
        if (mounted) {
          setIsLoaded(true)
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to load Google Places:', err)
          setError(err instanceof Error ? err.message : 'Failed to load')
        }
      }
    }

    init()

    return () => {
      mounted = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Fetch suggestions using new AutocompleteSuggestion API
  const fetchSuggestions = useCallback(async (input: string) => {
    if (!isLoaded || !input.trim() || input.length < 3) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    setIsLoading(true)

    try {
      // Use the new AutocompleteSuggestion.fetchAutocompleteSuggestions API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { suggestions: results } = await (google.maps.places.AutocompleteSuggestion as any).fetchAutocompleteSuggestions({
        input,
        includedRegionCodes: ['ca'],
        // Bias toward Quebec (Montreal area)
        locationBias: new google.maps.LatLngBounds(
          new google.maps.LatLng(44.5, -75.5), // SW corner
          new google.maps.LatLng(47.5, -71.0)  // NE corner
        ),
      })

      if (results && results.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: PlaceSuggestion[] = results.map((suggestion: any) => {
          const prediction = suggestion.placePrediction
          return {
            placeId: prediction?.placeId || '',
            description: prediction?.text?.text || '',
            mainText: prediction?.mainText?.text || '',
            secondaryText: prediction?.secondaryText?.text || '',
          }
        })
        setSuggestions(mapped)
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
  }, [isLoaded])

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

  // Handle suggestion selection using new Place API
  const handleSuggestionSelect = useCallback(async (suggestion: PlaceSuggestion) => {
    if (!suggestion.placeId) return

    setShowSuggestions(false)
    setInputValue(suggestion.description)

    try {
      // Use the new Place class
      const place = new google.maps.places.Place({
        id: suggestion.placeId,
      })

      // Fetch the required fields
      await place.fetchFields({
        fields: ['addressComponents', 'formattedAddress'],
      })

      if (place.addressComponents) {
        const parsed = parseAddressComponents(place.addressComponents)
        onPlaceSelectRef.current?.(parsed, place.formattedAddress || suggestion.description)
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
