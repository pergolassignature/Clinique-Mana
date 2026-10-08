import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { closeButtonClasses, overlayClasses } from './overlay-classes'

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(overlayClasses, className)}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Hide the default close button (use when providing custom header with close) */
  hideClose?: boolean
}

/** Right (default): 480px, slides in over 240ms. Other sides fade in. */
const sheetVariants = {
  top: 'inset-x-0 top-0 max-h-[80vh] border-b animate-fade-in motion-reduce:animate-none',
  bottom: 'inset-x-0 bottom-0 max-h-[80vh] border-t animate-fade-in motion-reduce:animate-none',
  left: 'inset-y-0 left-0 h-full w-full max-w-[480px] border-r animate-fade-in motion-reduce:animate-none',
  right: 'inset-y-0 right-0 h-full w-full max-w-[480px] border-l animate-slide-in-right motion-reduce:animate-none',
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', hideClose = false, className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      aria-modal="true"
      className={cn(
        'fixed z-50 flex flex-col bg-card text-foreground shadow-large',
        sheetVariants[side],
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          tabIndex={-1}
          className={closeButtonClasses}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex shrink-0 flex-col gap-1.5 px-5 pb-3 pr-12 pt-4', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

/** The scrolling middle of a sheet, between SheetHeader and SheetFooter. */
const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 pb-5', className)} {...props} />
)
SheetBody.displayName = 'SheetBody'

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex shrink-0 flex-col-reverse gap-2 border-t border-border p-3 sm:flex-row sm:justify-end', className)}
    {...props}
  />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
