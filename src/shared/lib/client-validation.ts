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
