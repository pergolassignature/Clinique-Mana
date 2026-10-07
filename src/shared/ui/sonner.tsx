import type { CSSProperties } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Toaster as SonnerToaster } from 'sonner'

export { toast } from 'sonner'

/**
 * Sonner styled as the design system's Toast, through its own CSS variables and inline styles
 * (no class overrides): 356px, ink background, white text, radius 6, padding 10×12, large shadow.
 * Only the icon carries the tone, in a light colour that reads on ink. The dark theme gives
 * sonner's close button light colours on the ink. The keyboard focus ring lives in globals.css.
 */
const toasterVariables = {
  fontFamily: 'inherit',
  '--width': '356px',
  '--border-radius': 'var(--radius-lg)',
  '--normal-bg': 'rgb(var(--ink))',
  '--normal-border': 'rgb(var(--ink))',
  '--normal-text': 'rgb(var(--text-inverse))',
} as CSSProperties

const toastStyle: CSSProperties = {
  padding: '10px 12px',
  gap: 12,
  alignItems: 'flex-start',
  boxShadow: 'var(--shadow-large)',
  fontSize: 'var(--text-sm)',
  lineHeight: 'var(--leading-sm)',
}

const icon = (Icon: typeof Info, color: string) => (
  <Icon aria-hidden className="h-4 w-4" style={{ color }} />
)

/** success teal-300, error pink-300, warning yellow-300, info 70 % white. */
const toastIcons = {
  success: icon(CircleCheck, 'rgb(var(--teal-300))'),
  error: icon(CircleAlert, 'rgb(var(--pink-300))'),
  warning: icon(TriangleAlert, 'rgb(var(--yellow-300))'),
  info: icon(Info, 'rgb(255 255 255 / 0.7)'),
}

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={20}
      theme="dark"
      closeButton
      icons={toastIcons}
      style={toasterVariables}
      toastOptions={{
        style: toastStyle,
        // Sonner's dark theme sets the description to 91 % white; the design system says 70 %.
        classNames: { description: '!text-white/70' },
      }}
    />
  )
}
