/** @param {string} name */
const brand = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Brand tokens (docs/standards/business-context.md §6). The RGB channels
      // live as CSS variables in src/styles/globals.css so opacity modifiers
      // (`bg-primary/10`) keep working.
      colors: {
        background: {
          DEFAULT: brand('offwhite'),
        },
        foreground: {
          DEFAULT: brand('charcoal'),
          secondary: brand('charcoal-soft'),
          muted: brand('charcoal-soft'),
        },
        border: {
          DEFAULT: brand('line'),
        },
        card: {
          DEFAULT: 'rgb(255 255 255 / <alpha-value>)',
          foreground: brand('charcoal'),
        },
        primary: {
          DEFAULT: brand('wine'),
          hover: brand('wine-dark'),
          foreground: 'rgb(255 255 255 / <alpha-value>)',
        },
        muted: {
          DEFAULT: brand('offwhite'),
          foreground: brand('charcoal-soft'),
        },
        accent: {
          DEFAULT: brand('mint'),
          // teal-dark on mint is 4.4:1, under WCAG AA for body text: text on
          // a mint surface stays charcoal; teal-dark is for text on white.
          foreground: brand('charcoal'),
        },
        success: {
          DEFAULT: brand('teal-dark'),
        },
        destructive: {
          DEFAULT: brand('danger'),
          foreground: 'rgb(255 255 255 / <alpha-value>)',
        },
        ring: {
          DEFAULT: brand('wine'),
        },
      },
      fontFamily: {
        sans: ['"Raleway Variable"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(0, 0, 0, 0.04)',
        medium: '0 4px 16px rgba(0, 0, 0, 0.06)',
        large: '0 8px 32px rgba(0, 0, 0, 0.08)',
      },
      animation: {
        'shimmer': 'shimmer 2s linear infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
    },
  },
  plugins: [],
}
