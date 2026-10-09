import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/utils'

/** Round; 24 / 32 / 48 px with 10 / 12 / 16 px initials. */
const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full font-medium', {
  variants: {
    size: {
      sm: 'h-6 w-6 text-[10px] leading-none', // design-tokens: allow (24 px avatar initials: 10 px in the design system)
      md: 'h-8 w-8 text-xs',
      lg: 'h-12 w-12 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>
>(({ className, size, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(avatarVariants({ size }), className)}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

/**
 * A photo filling the circle (`object-cover`). Radix shows it only once loaded: until then, and
 * on error, the `AvatarFallback` (the initials) stays.
 */
const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn('h-full w-full object-cover', className)} {...props} />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

/** Two-letter initials on grey, with a 1px inner ring. */
const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full bg-muted text-gray-700 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]',
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarFallback, AvatarImage }
