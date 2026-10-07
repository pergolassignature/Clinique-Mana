import { Toaster as SonnerToaster } from 'sonner'

export { toast } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      toastOptions={{
        // `!` wins over sonner's injected [data-sonner-toast] styles.
        classNames: {
          toast: '!rounded-xl !border-border !bg-card !font-sans !text-foreground !shadow-medium',
          description: '!text-muted-foreground',
          closeButton: '!border-border !bg-card !text-foreground',
          success: '[&_[data-icon]]:text-success',
          error: '!text-destructive [&_[data-icon]]:text-destructive',
        },
      }}
    />
  )
}
