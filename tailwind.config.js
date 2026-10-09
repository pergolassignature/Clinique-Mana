import plugin from 'tailwindcss/plugin'

/** A design-system colour (RGB channels in src/styles/globals.css), opacity modifiers included. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

/**
 * Clinique MANA design system → Tailwind (docs/standards/brand.tokens.md).
 * The values live as CSS variables in src/styles/globals.css; this file only maps them to the
 * shadcn semantic names. New font-size or shadow keys must also be registered in
 * src/shared/lib/utils.ts (tailwind-merge).
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('bg'),
        foreground: token('text-body'),
        // --text-muted: placeholders, disabled text, separators and icons only (3.3:1, decision #30).
        subtle: token('text-muted'),
        link: token('text-link'),
        border: {
          DEFAULT: token('border'),
          light: token('border-light'),
          strong: token('border-strong'),
        },
        // Form-control borders: their own token (Task 2.2), hairline as designed (decision #30).
        input: {
          DEFAULT: token('border'),
          hover: token('border-strong'),
        },
        card: {
          DEFAULT: token('surface-card'),
          hover: token('surface-panel-hover'),
          foreground: token('text-body'),
        },
        muted: {
          DEFAULT: token('bg-secondary'),
          strong: token('bg-tertiary'),
          // Informative secondary text (5.3:1, decision #30).
          foreground: token('text-secondary'),
        },
        sidebar: token('surface-sidebar'),
        overlay: 'var(--surface-overlay)',
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          active: token('primary-active'),
          foreground: token('primary-fg'),
          soft: token('primary-soft'),
          'soft-foreground': token('primary-soft-fg'),
        },
        ink: {
          DEFAULT: token('ink'),
          hover: token('ink-hover'),
          foreground: token('text-inverse'),
        },
        destructive: {
          DEFAULT: token('danger'),
          hover: token('danger-hover'),
          foreground: token('text-inverse'),
        },
        // Status colours: dots and icons only, never text or fills.
        success: token('success'),
        warning: {
          DEFAULT: token('warning'),
          // yellow-700 (#9A7B05, ~4:1): a warning icon that must be seen, e.g. the pending clock (decision #30).
          strong: token('yellow-700'),
        },
        info: token('info'),
        neutral: token('neutral-dot'),
        ring: token('focus-ring'),
        gray: {
          50: token('gray-50'),
          100: token('gray-100'),
          200: token('gray-200'),
          300: token('gray-300'),
          400: token('gray-400'),
          500: token('gray-500'),
          600: token('gray-600'),
          700: token('gray-700'),
          800: token('gray-800'),
          900: token('gray-900'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['var(--text-2xs)', 'var(--leading-2xs)'],
        xs: ['var(--text-xs)', 'var(--leading-xs)'],
        sm: ['var(--text-sm)', 'var(--leading-sm)'],
        base: ['var(--text-base)', 'var(--leading-base)'],
        lg: ['var(--text-lg)', 'var(--leading-lg)'],
        xl: ['var(--text-xl)', 'var(--leading-xl)'],
        '2xl': ['var(--text-2xl)', 'var(--leading-2xl)'],
        '3xl': ['var(--text-3xl)', 'var(--leading-3xl)'],
      },
      letterSpacing: {
        tight: 'var(--tracking-tight)',
        wide: 'var(--tracking-wide)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        medium: 'var(--shadow-medium)',
        large: 'var(--shadow-large)',
        // Keyboard focus: 2px white gap + 2px solid teal (buttons, controls)…
        focus: 'var(--ring)',
        // …and the 1px teal ring that fields add to their teal border.
        'focus-inset': 'var(--ring-inset)',
        // Highlighted menu and command items (arrow keys): a 2px teal bar on the left (decision #30).
        highlight: 'var(--highlight-bar)',
      },
      maxWidth: {
        form: 'var(--form-max)',
        content: 'var(--content-max)',
      },
      transitionDuration: {
        DEFAULT: '160ms',
        120: '120ms',
        160: '160ms',
        240: '240ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      animation: {
        'fade-in': 'fade-in 160ms cubic-bezier(0, 0, 0.2, 1)',
        'dialog-in': 'dialog-in 160ms cubic-bezier(0, 0, 0.2, 1)',
        'dialog-in-top': 'dialog-in-top 160ms cubic-bezier(0, 0, 0.2, 1)',
        'zoom-in': 'zoom-in 120ms cubic-bezier(0, 0, 0.2, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Dialogs are centred with translate(-50%, -50%): the zoom keeps it.
        'dialog-in': {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.95)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        // A top-anchored dialog (position="top") is centred horizontally only.
        'dialog-in-top': {
          from: { opacity: '0', transform: 'translate(-50%, 0) scale(0.95)' },
          to: { opacity: '1', transform: 'translate(-50%, 0) scale(1)' },
        },
        'zoom-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [
    // Container queries (Tailwind 3 has none built in; the official plugin is one more dependency
    // for three widths): `container-inline` on the box whose width counts, then `cq-480:`,
    // `cq-720:`, `cq-880:` (min-width) on what it holds. Used where a card's width, not the
    // window's, decides the layout (the professionals table, P4-63: the sidebar makes the card
    // narrower at 768px than at 640px).
    plugin(({ addUtilities, addVariant }) => {
      addUtilities({ '.container-inline': { 'container-type': 'inline-size' } })
      for (const width of [480, 720, 880]) addVariant(`cq-${width}`, `@container (min-width: ${width}px)`)
    }),
  ],
}
