import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge 2.x (the line for Tailwind 3), taught the theme's custom keys (tailwind.config.js):
 * - shadows `soft`/`medium`/`large`/`focus`/`focus-inset`/`highlight`: otherwise read as shadow colours, and
 *   `cn('shadow-soft', 'shadow-none')` keeps both;
 * - font size `2xs`: otherwise read as a text colour, and `cn('text-2xs', 'text-sm')` keeps both.
 * Register any new shadow or font-size key here, with a test.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['soft', 'medium', 'large', 'focus', 'focus-inset', 'highlight'] }],
      'font-size': [{ text: ['2xs'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
