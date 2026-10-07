import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge 2.x (the line for Tailwind 3), taught the theme's custom shadow scale
 * (`boxShadow` in tailwind.config.js). Without it, `shadow-soft` is read as a shadow colour
 * and `cn('shadow-soft', 'shadow-none')` keeps both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['soft', 'medium', 'large'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
