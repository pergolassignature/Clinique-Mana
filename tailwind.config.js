/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Clinique MANA brand colors
        background: {
          DEFAULT: '#FDFBF7', // Warm off-white/cream
          secondary: '#F8F5F0', // Slightly darker cream
          tertiary: '#F2EDE5', // Light warm gray
        },
        foreground: {
          DEFAULT: '#3D3D3D', // Dark gray (not pure black)
          secondary: '#6B6B6B', // Medium gray
          muted: '#9A9A9A', // Light gray
        },
        border: {
          DEFAULT: '#E8E4DC', // Soft neutral gray
          light: '#F0EBE3',
        },
        // Primary accent: soft sage/mint green
        sage: {
          50: '#F4F7F5',
          100: '#E8EFE9',
          200: '#D1DFD4',
          300: '#B3C9B8',
          400: '#8FB097',
          500: '#6B9775', // Primary
          600: '#567A5F',
          700: '#45634D',
          800: '#3A5140',
          900: '#324436',
        },
        // Secondary accent: muted warm yellow
        honey: {
          50: '#FDF9F0',
          100: '#FAF1DC',
          200: '#F5E3B8',
          300: '#EDD08A',
          400: '#E4BC5C',
          500: '#D9A832', // Primary
          600: '#C4912A',
          700: '#A37325',
          800: '#855C24',
          900: '#6E4C21',
        },
        // Tertiary accent: muted burgundy/wine (sparingly)
        wine: {
          50: '#FAF5F5',
          100: '#F5EBEB',
          200: '#EBDADA',
          300: '#DCC0C0',
          400: '#C79999',
          500: '#A67373', // Primary
          600: '#8A5C5C',
          700: '#724C4C',
          800: '#5E4040',
          900: '#503838',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
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
