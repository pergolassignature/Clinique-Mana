import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge 2.x (the line for Tailwind 3), taught the theme's custom keys (tailwind.config.js):
 * - shadows `soft`/`medium`/`large`/`focus`/`focus-inset`/`highlight`: otherwise read as shadow colours, and
 *   `cn('shadow-soft', 'shadow-none')` keeps both;
 * - font size `2xs`: otherwise read as a text colour, and `cn('text-2xs', 'text-sm')` keeps both;
 * - max widths `form`/`content`: otherwise unknown, and `cn('max-w-form', 'max-w-sm')` keeps both;
 * - animations (`dialog-in`, `dialog-in-top`…): otherwise unknown, and `cn('animate-dialog-in',
 *   'animate-dialog-in-top')` keeps both (the CSS order would then pick one).
 * Register any new shadow, font-size or animation key here, with a test.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['soft', 'medium', 'large', 'focus', 'focus-inset', 'highlight'] }],
      'font-size': [{ text: ['2xs'] }],
      'max-w': [{ 'max-w': ['form', 'content'] }],
      animate: [{ animate: ['shimmer', 'fade-in', 'dialog-in', 'dialog-in-top', 'zoom-in', 'slide-in-right', 'accordion-down', 'accordion-up'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
