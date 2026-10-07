/**
 * Keyboard focus for buttons and controls: 2px white gap + 2px solid teal (decision #30).
 * `outline-none` is Tailwind's transparent outline, so forced-colors mode still shows focus.
 */
export const focusRing = 'focus-visible:shadow-focus focus-visible:outline-none'

/**
 * Field classes shared by Input, Select and Textarea: hairline border that darkens on hover,
 * teal border + 1px teal ring on focus, grey fill when disabled, red border when invalid.
 * Read-only (`[readonly]`) keeps the body text colour (full contrast, unlike disabled) on the grey
 * fill, with a default cursor and no hover darkening; focus still shows, so it can be tabbed to.
 * Tailwind orders the variants hover < focus-visible < disabled < aria-*, so a hovered focused
 * field stays teal and an invalid one stays red. Text is 16px on phones so iOS does not zoom on
 * focus, 13px from `sm` up (decision #30).
 */
export const fieldClasses =
  'w-full rounded-md border border-input bg-card text-lg text-foreground transition-colors placeholder:text-subtle hover:border-input-hover focus-visible:border-primary focus-visible:shadow-focus-inset focus-visible:outline-none disabled:cursor-not-allowed disabled:border-input disabled:bg-muted disabled:text-muted-foreground [&[readonly]]:cursor-default [&[readonly]]:bg-muted [&[readonly]:not(:focus-visible)]:hover:border-input aria-[invalid=true]:border-destructive sm:text-sm'
