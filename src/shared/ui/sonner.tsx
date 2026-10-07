import type { CSSProperties } from 'react'
import { Toaster as SonnerToaster } from 'sonner'

export { toast } from 'sonner'

const card = 'rgb(255 255 255)'
const line = 'rgb(var(--line))'
const charcoal = 'rgb(var(--charcoal))'

/**
 * Sonner styled through its own CSS variables (set on the toaster element).
 * richColors only switches the success/error text and icon colour: every toast
 * stays a white card. The keyboard focus ring lives in globals.css.
 */
const brandVariables = {
  fontFamily: 'inherit',
  '--border-radius': '14px',
  '--normal-bg': card,
  '--normal-border': line,
  '--normal-text': charcoal,
  '--success-bg': card,
  '--success-border': line,
  '--success-text': 'rgb(var(--teal-dark))',
  '--error-bg': card,
  '--error-border': line,
  '--error-text': 'rgb(var(--danger))',
  '--info-bg': card,
  '--info-border': line,
  '--info-text': charcoal,
  '--warning-bg': card,
  '--warning-border': line,
  '--warning-text': charcoal,
} as CSSProperties

export function Toaster() {
  return <SonnerToaster position="top-right" richColors closeButton style={brandVariables} />
}
