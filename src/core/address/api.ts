import { z } from 'zod'
import { invokeFunction } from '@/core/supabase/functions'

/**
 * The `places` edge function (P4-220): Google Places suggestions for a typed address, and the
 * chosen place's address. Only the typed text, a place id and the session token are sent: no name,
 * no record id. Nothing here logs what was typed.
 */

/** One suggestion: `mainText` is the street (« 1234 Rue Saint-Denis »), `secondaryText` the rest. */
export interface AddressSuggestion {
  placeId: string
  mainText: string
  secondaryText: string
}

/**
 * The chosen place's address (`supabase/functions/places/address.ts`): `line1` « 1234, rue
 * Saint-Denis », `line2` the unit as Google gives it (« 402 »), `province` one of the 13 codes,
 * `postalCode` « H2X 3J6 ». Any field may be null.
 */
export interface PlaceAddress {
  line1: string | null
  line2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  country: string | null
}

const suggestionsSchema = z.object({
  suggestions: z.array(z.object({ place_id: z.string(), main_text: z.string(), secondary_text: z.string() })),
})

const addressSchema = z.object({
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    province: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string().nullable(),
  }),
})

/** A new session token (a UUID v4, as Google recommends): one per typing session of a field. */
export function newPlacesSession(): string {
  return crypto.randomUUID()
}

/** Suggestions for `input` (3–200 characters, trimmed by the caller). Throws a FunctionCallError. */
export async function fetchAddressSuggestions(input: string, session: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const data = suggestionsSchema.parse(await invokeFunction('places', { action: 'autocomplete', input, session }, { signal }))
  return data.suggestions.map((s) => ({ placeId: s.place_id, mainText: s.main_text, secondaryText: s.secondary_text }))
}

/** The address of a suggestion; ends the session (the caller starts a new one). Throws a FunctionCallError. */
export async function fetchPlaceAddress(placeId: string, session: string, signal?: AbortSignal): Promise<PlaceAddress> {
  const { address } = addressSchema.parse(await invokeFunction('places', { action: 'details', place_id: placeId, session }, { signal }))
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    province: address.province,
    postalCode: address.postal_code,
    country: address.country,
  }
}
