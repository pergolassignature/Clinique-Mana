/**
 * Field classes shared by Input, Select and Textarea: hairline border that darkens on hover,
 * teal border + 1px teal ring on focus, grey fill when disabled, red border when invalid.
 * Tailwind orders the variants hover < focus-visible < disabled < aria-*, so a hovered focused
 * field stays teal and an invalid one stays red.
 */
export const fieldClasses =
  'w-full rounded-md border border-input bg-card text-sm text-foreground transition-colors placeholder:text-subtle hover:border-input-hover focus-visible:border-primary focus-visible:shadow-focus-inset focus-visible:outline-none disabled:cursor-not-allowed disabled:border-input disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-destructive'
