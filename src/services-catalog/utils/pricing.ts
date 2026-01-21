// src/services-catalog/utils/pricing.ts

// Parse price string to cents, returns null if empty/invalid
export function parsePriceToCents(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const num = parseFloat(trimmed.replace(',', '.'))
  if (isNaN(num) || num < 0) return null
  return Math.round(num * 100)
}

// Format cents to display string
export function formatCentsToDisplay(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2)
}
