import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

interface AddressComponent {
  longText?: string
  shortText?: string
  types: string[]
}

interface ParsedAddress {
  streetNumber: string | null
  streetName: string | null
  city: string | null
  province: string | null
  country: string
  postalCode: string | null
}

function parseAddressComponents(components: AddressComponent[]): ParsedAddress {
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { placeId } = await req.json()

    if (!placeId) {
      return new Response(
        JSON.stringify({ error: 'placeId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!apiKey) {
      throw new Error('Google Places API key not configured')
    }

    // Use Google Places Details API (New)
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'addressComponents,formattedAddress',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Google Places API error:', errorText)
      throw new Error(`Google API error: ${response.status}`)
    }

    const data = await response.json()

    // Parse address components
    const parsed = parseAddressComponents(data.addressComponents || [])

    return new Response(
      JSON.stringify({
        address: parsed,
        formattedAddress: data.formattedAddress || '',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
