import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  type DuplicateCheckPayload,
} from '@/shared/lib/client-validation'

// ============================================
// TYPES
// ============================================

export type DuplicateConfidence = 'high' | 'medium' | 'none'

export interface DuplicateMatch {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  confidence: DuplicateConfidence
  matchReasons: string[] // e.g., ['email', 'phone', 'name+dob']
}

export interface DuplicateDetectionResult {
  isChecking: boolean
  matches: DuplicateMatch[]
  highestConfidence: DuplicateConfidence
  hasHighConfidenceDuplicate: boolean
  hasMediumConfidenceDuplicate: boolean
}

interface CachedResult {
  key: string
  matches: DuplicateMatch[]
  timestamp: number
}

// ============================================
// CONSTANTS
// ============================================

const DEBOUNCE_MS = 400
const CACHE_TTL_MS = 30000 // 30 seconds cache

// ============================================
// HELPER: Generate cache key from payload
// ============================================

function generateCacheKey(payload: DuplicateCheckPayload): string {
  return `${payload.normalizedEmail}|${payload.normalizedPhone}|${payload.normalizedFirstName}|${payload.normalizedLastName}|${payload.dateOfBirth}`
}

// ============================================
// HELPER: Calculate similarity between strings (Levenshtein-based)
// ============================================

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (!str1 || !str2) return 0

  const longer = str1.length > str2.length ? str1 : str2
  const shorter = str1.length > str2.length ? str2 : str1

  if (longer.length === 0) return 1

  // Simple similarity based on common prefix/suffix and length ratio
  const lengthRatio = shorter.length / longer.length

  // Check if one contains the other
  if (longer.includes(shorter) || shorter.includes(longer)) {
    return Math.max(0.7, lengthRatio)
  }

  // Check common prefix
  let commonPrefix = 0
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) commonPrefix++
    else break
  }

  return commonPrefix / longer.length
}

// ============================================
// HOOK: useDuplicateDetection
// ============================================

export function useDuplicateDetection(
  payload: DuplicateCheckPayload | null,
  options: { enabled?: boolean } = {}
): DuplicateDetectionResult {
  const { enabled = true } = options

  const [isChecking, setIsChecking] = useState(false)
  const [matches, setMatches] = useState<DuplicateMatch[]>([])

  // Refs for debouncing and race condition handling
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const cacheRef = useRef<CachedResult | null>(null)

  // Check cache validity
  const getCachedResult = useCallback((key: string): DuplicateMatch[] | null => {
    if (!cacheRef.current) return null
    if (cacheRef.current.key !== key) return null
    if (Date.now() - cacheRef.current.timestamp > CACHE_TTL_MS) return null
    return cacheRef.current.matches
  }, [])

  // Set cache
  const setCachedResult = useCallback((key: string, matches: DuplicateMatch[]) => {
    cacheRef.current = { key, matches, timestamp: Date.now() }
  }, [])

  // Perform the actual duplicate check
  const performCheck = useCallback(
    async (checkPayload: DuplicateCheckPayload, requestId: number) => {
      const cacheKey = generateCacheKey(checkPayload)

      // Check cache first
      const cachedMatches = getCachedResult(cacheKey)
      if (cachedMatches !== null) {
        setMatches(cachedMatches)
        setIsChecking(false)
        return
      }

      setIsChecking(true)

      try {
        // Cancel previous request if exists
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }
        abortControllerRef.current = new AbortController()

        // Build the query - search for potential duplicates
        // We search by: email OR phone OR (first+last+dob)
        const { normalizedEmail, normalizedPhone, normalizedFirstName, normalizedLastName, dateOfBirth } = checkPayload

        // Only search if we have meaningful data
        const hasEmail = normalizedEmail.length > 0
        const hasPhone = normalizedPhone.length >= 10
        const hasNameAndDob = normalizedFirstName.length > 0 && normalizedLastName.length > 0 && dateOfBirth

        if (!hasEmail && !hasPhone && !hasNameAndDob) {
          setMatches([])
          setIsChecking(false)
          return
        }

        // Query Supabase for potential matches
        // We use .or() to search multiple conditions
        let query = supabase
          .from('clients')
          .select('id, first_name, last_name, email, phone_primary, date_of_birth')
          .limit(10)

        // Build OR conditions
        const orConditions: string[] = []

        if (hasEmail) {
          orConditions.push(`email.ilike.${normalizedEmail}`)
        }

        if (hasPhone) {
          // Search for phone with or without country code
          // We'll filter in JS after for better normalization
          orConditions.push(`phone_primary.ilike.%${normalizedPhone.slice(-10)}%`)
        }

        if (hasNameAndDob) {
          // For name+dob, we need to search separately
          // Can't easily combine in Supabase .or() with complex conditions
        }

        if (orConditions.length > 0) {
          query = query.or(orConditions.join(','))
        }

        const { data, error } = await query

        // Check if this request is still the latest
        if (requestId !== requestIdRef.current) {
          return // Stale request, ignore
        }

        if (error) {
          console.error('Duplicate check error:', error)
          setMatches([])
          setIsChecking(false)
          return
        }

        // Also do a separate query for name+dob match
        let nameMatches: typeof data = []
        if (hasNameAndDob) {
          const { data: nameData } = await supabase
            .from('clients')
            .select('id, first_name, last_name, email, phone_primary, date_of_birth')
            .ilike('first_name', `%${normalizedFirstName}%`)
            .ilike('last_name', `%${normalizedLastName}%`)
            .eq('date_of_birth', dateOfBirth)
            .limit(10)

          if (nameData && requestId === requestIdRef.current) {
            nameMatches = nameData
          }
        }

        // Check if still latest request after second query
        if (requestId !== requestIdRef.current) {
          return
        }

        // Combine and deduplicate results
        const allResults = [...(data || []), ...nameMatches]
        const uniqueResults = allResults.filter(
          (item, index, self) => index === self.findIndex((t) => t.id === item.id)
        )

        // Analyze matches and assign confidence based on refined rules:
        // LEVEL 1 (HIGH/CERTAIN): exact email OR exact phone OR exact (first+last+dob)
        //   - Hard block, no override allowed
        // LEVEL 2 (MEDIUM/POSSIBLE): same first+last name OR partial similarity with contact match
        //   - Soft warning, requires confirmation
        // LEVEL 3 (NONE): no match
        const analyzedMatches: DuplicateMatch[] = uniqueResults.map((client) => {
          const matchReasons: string[] = []
          let confidence: DuplicateConfidence = 'none'

          const clientEmail = client.email ? normalizeEmail(client.email) : ''
          const clientPhone = client.phone_primary ? normalizePhone(client.phone_primary) : ''
          const clientFirstName = normalizeName(client.first_name || '')
          const clientLastName = normalizeName(client.last_name || '')

          // ===== LEVEL 1: CERTAIN DUPLICATE (hard block) =====
          // Only these exact matches trigger hard block

          // 1. Exact email match
          if (hasEmail && clientEmail && clientEmail === normalizedEmail) {
            matchReasons.push('email')
            confidence = 'high'
          }

          // 2. Exact phone match (normalized to last 10 digits)
          if (hasPhone && clientPhone) {
            const payloadPhoneLast10 = normalizedPhone.slice(-10)
            const clientPhoneLast10 = clientPhone.slice(-10)
            if (payloadPhoneLast10.length === 10 && payloadPhoneLast10 === clientPhoneLast10) {
              matchReasons.push('phone')
              confidence = 'high'
            }
          }

          // 3. Exact first name + last name + date of birth
          if (
            hasNameAndDob &&
            client.date_of_birth === dateOfBirth &&
            clientFirstName === normalizedFirstName &&
            clientLastName === normalizedLastName
          ) {
            matchReasons.push('name+dob')
            confidence = 'high'
          }

          // ===== LEVEL 2: POSSIBLE DUPLICATE (soft warning) =====
          // Only check if not already a certain duplicate
          if (confidence === 'none' && normalizedFirstName && normalizedLastName) {
            // Check exact name match (without DOB)
            const hasExactNameMatch =
              clientFirstName === normalizedFirstName &&
              clientLastName === normalizedLastName

            if (hasExactNameMatch) {
              // Same name but different DOB or contact - possible duplicate
              matchReasons.push('same_name')
              confidence = 'medium'
            } else {
              // Check fuzzy name similarity
              const firstNameSimilarity = calculateSimilarity(clientFirstName, normalizedFirstName)
              const lastNameSimilarity = calculateSimilarity(clientLastName, normalizedLastName)
              const hasSimilarName = firstNameSimilarity > 0.8 && lastNameSimilarity > 0.8

              if (hasSimilarName) {
                // Similar name needs partial contact match to trigger warning
                const normalizedEmailLocal = normalizedEmail.split('@')[0] || ''
                const clientEmailLocal = clientEmail.split('@')[0] || ''
                const hasPartialEmailMatch =
                  hasEmail &&
                  clientEmail &&
                  normalizedEmail.length > 5 &&
                  normalizedEmailLocal.length > 0 &&
                  clientEmailLocal.length > 0 &&
                  (clientEmail.includes(normalizedEmailLocal) ||
                    normalizedEmail.includes(clientEmailLocal))

                const hasPartialPhoneMatch =
                  hasPhone &&
                  clientPhone &&
                  normalizedPhone.length >= 7 &&
                  (clientPhone.includes(normalizedPhone.slice(-7)) ||
                    normalizedPhone.includes(clientPhone.slice(-7)))

                if (hasPartialEmailMatch || hasPartialPhoneMatch) {
                  matchReasons.push('similar_name')
                  if (hasPartialEmailMatch) matchReasons.push('partial_email')
                  if (hasPartialPhoneMatch) matchReasons.push('partial_phone')
                  confidence = 'medium'
                }
              }
            }
          }

          return {
            id: client.id,
            firstName: client.first_name || '',
            lastName: client.last_name || '',
            email: client.email,
            phone: client.phone_primary,
            dateOfBirth: client.date_of_birth,
            confidence,
            matchReasons,
          }
        })

        // Filter to only include actual matches (not 'none')
        const actualMatches = analyzedMatches.filter((m) => m.confidence !== 'none')

        // Sort by confidence (high first)
        actualMatches.sort((a, b) => {
          const order: Record<DuplicateConfidence, number> = { high: 0, medium: 1, none: 2 }
          return order[a.confidence] - order[b.confidence]
        })

        // Cache the result
        setCachedResult(cacheKey, actualMatches)

        setMatches(actualMatches)
        setIsChecking(false)
      } catch (err) {
        // Check if it's an abort error (expected)
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        console.error('Duplicate detection error:', err)
        setMatches([])
        setIsChecking(false)
      }
    },
    [getCachedResult, setCachedResult]
  )

  // Effect to trigger debounced check
  useEffect(() => {
    if (!enabled || !payload) {
      setMatches([])
      setIsChecking(false)
      return
    }

    // Check if we have enough data to search
    const hasEnoughData =
      payload.normalizedEmail.length > 3 ||
      payload.normalizedPhone.length >= 10 ||
      (payload.normalizedFirstName.length > 1 && payload.normalizedLastName.length > 1)

    if (!hasEnoughData) {
      setMatches([])
      setIsChecking(false)
      return
    }

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Increment request ID to track latest request
    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current

    // Set checking state immediately for responsiveness
    setIsChecking(true)

    // Debounce the actual query
    debounceTimerRef.current = setTimeout(() => {
      performCheck(payload, currentRequestId)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [payload, enabled, performCheck])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Calculate derived values
  const firstMatch = matches[0]
  const highestConfidence: DuplicateConfidence = firstMatch ? firstMatch.confidence : 'none'
  const hasHighConfidenceDuplicate = matches.some((m) => m.confidence === 'high')
  const hasMediumConfidenceDuplicate = matches.some((m) => m.confidence === 'medium')

  return {
    isChecking,
    matches,
    highestConfidence,
    hasHighConfidenceDuplicate,
    hasMediumConfidenceDuplicate,
  }
}
