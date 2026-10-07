/**
 * Client validation and normalization utilities
 * Used for duplicate detection and form validation
 */

// ============================================
// NORMALIZATION FUNCTIONS
// ============================================

/**
 * Normalize email to lowercase, trimmed
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

/**
 * Normalize phone number to digits only
 * Removes all non-digit characters (spaces, dashes, parentheses, etc.)
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number to E.164 format for database storage.
 * E.164 format: +[country code][digits] (e.g., +15145551234)
 *
 * @param phone - Input phone number in any format
 * @param countryCode - Country code to prepend (default: +1 for North America)
 * @returns E.164 formatted phone number or null if invalid
 */
export function normalizePhoneToE164(
  phone: string | null | undefined,
  countryCode: string = '+1'
): string | null {
  if (!phone) return null

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')

  if (digits.length === 0) return null

  // Handle different input formats
  // If already has country code (11+ digits starting with country code digit)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // Standard 10-digit North American number
  if (digits.length === 10) {
    const cleanCountryCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`
    const codeDigits = cleanCountryCode.replace(/\D/g, '')
    return `+${codeDigits}${digits}`
  }

  // If it's a shorter or longer number, just store digits with country code
  // This handles international numbers and partial numbers
  if (digits.length >= 7) {
    const cleanCountryCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`
    const codeDigits = cleanCountryCode.replace(/\D/g, '')
    return `+${codeDigits}${digits}`
  }

  // Too short to be valid, store as-is (might be extension or partial)
  return digits.length > 0 ? digits : null
}

/**
 * Format E.164 phone number for display.
 * Converts +15145551234 to +1 (514) 555-1234
 *
 * @param phone - Phone number in E.164 format
 * @returns Formatted phone number for display
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return ''

  // If phone is already in E.164 format (starts with +), format it nicely
  if (phone.startsWith('+')) {
    const digits = phone.slice(1) // Remove the +
    if (digits.length === 11 && digits.startsWith('1')) {
      // North American number: +1 (XXX) XXX-XXXX
      const area = digits.slice(1, 4)
      const first = digits.slice(4, 7)
      const last = digits.slice(7, 11)
      return `+1 (${area}) ${first}-${last}`
    } else if (digits.length === 10) {
      // 10 digit number without country code stored
      const area = digits.slice(0, 3)
      const first = digits.slice(3, 6)
      const last = digits.slice(6, 10)
      return `(${area}) ${first}-${last}`
    }
  }

  // Return as-is if format not recognized
  return phone
}

/**
 * Normalize name for comparison (lowercase, trimmed, collapse whitespace)
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

/**
 * Validate Canadian phone number (basic check: 10 digits)
 */
export function isValidCanadianPhone(phone: string): boolean {
  const digits = normalizePhone(phone)
  // Canadian phone: 10 digits (area code + 7 digits)
  // Or 11 digits if starting with 1 (country code)
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

/**
 * Check if date is not in the future
 */
export function isValidDateOfBirth(dateString: string): boolean {
  if (!dateString) return false
  const date = new Date(dateString)
  const today = new Date()
  today.setHours(23, 59, 59, 999) // End of today
  return date <= today && !isNaN(date.getTime())
}

/**
 * Validate name (not empty, not only numbers, reasonable length)
 */
export function isValidName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length > 100) return false
  // Check if it's only numbers/special chars (no letters)
  if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) return false
  return true
}

// ============================================
// DUPLICATE CHECK PAYLOAD
// ============================================

export interface DuplicateCheckPayload {
  normalizedEmail: string
  normalizedPhone: string
  normalizedFirstName: string
  normalizedLastName: string
  dateOfBirth: string
}

/**
 * Build normalized payload for duplicate checking
 */
export function buildDuplicateCheckPayload(formState: {
  firstName: string
  lastName: string
  dateOfBirth: string
  email: string
  phone: string
}): DuplicateCheckPayload {
  return {
    normalizedEmail: normalizeEmail(formState.email),
    normalizedPhone: normalizePhone(formState.phone),
    normalizedFirstName: normalizeName(formState.firstName),
    normalizedLastName: normalizeName(formState.lastName),
    dateOfBirth: formState.dateOfBirth,
  }
}

// ============================================
// FORM FIELD VALIDATION
// ============================================

export interface FieldValidationResult {
  isValid: boolean
  error?: string
}

export interface FormValidationErrors {
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  email?: string
  phone?: string
}

/**
 * Validate a single field and return error message key if invalid
 */
export function validateField(
  field: keyof FormValidationErrors,
  value: string
): FieldValidationResult {
  const trimmed = value.trim()

  switch (field) {
    case 'firstName':
    case 'lastName':
      if (!trimmed) {
        return { isValid: false, error: 'required' }
      }
      if (!isValidName(trimmed)) {
        return { isValid: false, error: 'invalidName' }
      }
      return { isValid: true }

    case 'email':
      if (!trimmed) {
        return { isValid: false, error: 'required' }
      }
      if (!isValidEmail(trimmed)) {
        return { isValid: false, error: 'invalidEmail' }
      }
      return { isValid: true }

    case 'phone':
      if (!trimmed) {
        return { isValid: false, error: 'required' }
      }
      if (!isValidCanadianPhone(trimmed)) {
        return { isValid: false, error: 'invalidPhone' }
      }
      return { isValid: true }

    case 'dateOfBirth':
      if (!trimmed) {
        return { isValid: false, error: 'required' }
      }
      if (!isValidDateOfBirth(trimmed)) {
        return { isValid: false, error: 'invalidDateOfBirth' }
      }
      return { isValid: true }

    default:
      return { isValid: true }
  }
}

/**
 * Validate all form fields
 */
export function validateAllFields(formState: {
  firstName: string
  lastName: string
  dateOfBirth: string
  email: string
  phone: string
}): { isValid: boolean; errors: FormValidationErrors } {
  const errors: FormValidationErrors = {}
  let isValid = true

  const fields: (keyof FormValidationErrors)[] = [
    'firstName',
    'lastName',
    'dateOfBirth',
    'email',
    'phone',
  ]

  for (const field of fields) {
    const result = validateField(field, formState[field])
    if (!result.isValid && result.error) {
      errors[field] = result.error
      isValid = false
    }
  }

  return { isValid, errors }
}
