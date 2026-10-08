/**
 * Design-system values for emails, copied from
 * `docs/design-system/design_system/tokens/colors.css` and `typography.css`.
 * Email clients ignore CSS variables and most `<style>` blocks, so every
 * element carries these as inline styles.
 */

/** `--font-sans`, with web-safe fallbacks (no web font is loaded). */
export const FONT_STACK =
  "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

/** Colour tokens used by the email layout and the body markup. */
export const COLOR = {
  /** `--text-body` (gray-900). */
  text: '#1F1F20',
  /** `--text-secondary` (gray-600). */
  secondary: '#6B6B6E',
  /** `--border`, the hairline. */
  hairline: '#E4E4E7',
  /** `--primary` (teal-600), the action colour. */
  primary: '#1E837C',
  /** `--primary-fg`. */
  primaryText: '#FFFFFF',
  /** `--surface-card`. */
  card: '#FFFFFF',
  /** `--bg-secondary`, behind the card. */
  page: '#F4F4F5',
} as const

/** Body text: `--text-lg` / `--leading-lg` (the app's 13 px is too small to read in a mail client). */
export const BODY_TEXT =
  `font-family:${FONT_STACK};font-size:16px;line-height:24px;color:${COLOR.text}`

/** Footer and fallback-link text: `--text-xs` / `--leading-xs`, secondary colour. */
export const SMALL_TEXT =
  `font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${COLOR.secondary}`
