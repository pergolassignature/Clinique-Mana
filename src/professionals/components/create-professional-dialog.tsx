import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface CreateProfessionalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: {
    displayName: string
    email: string
    sendInvite: boolean
  }) => Promise<{ success: boolean; error?: Error; professionalId?: string }>
  onSuccess?: (professionalId: string) => void
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CreateProfessionalDialog({
  open,
  onOpenChange,
  onSubmit,
  onSuccess,
}: CreateProfessionalDialogProps) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ displayName?: string; email?: string }>({})

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setDisplayName('')
      setEmail('')
      setSendInvite(true)
      setErrors({})
    }
  }, [open])

  const validateForm = useCallback((): boolean => {
    const newErrors: { displayName?: string; email?: string } = {}

    if (!displayName.trim()) {
      newErrors.displayName = t('professionals.create.validation.nameRequired')
    }

    if (!email.trim()) {
      newErrors.email = t('professionals.create.validation.emailRequired')
    } else if (!EMAIL_REGEX.test(email)) {
      newErrors.email = t('professionals.create.validation.emailInvalid')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [displayName, email])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)
    const result = await onSubmit({
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      sendInvite,
    })
    setIsSubmitting(false)

    if (result.success && result.professionalId) {
      onOpenChange(false)
      onSuccess?.(result.professionalId)
    } else if (result.error) {
      // Handle specific error cases
      if (result.error.message.includes('courriel') || result.error.message.includes('email')) {
        setErrors({ email: t('professionals.create.errors.emailExists') })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('professionals.create.title')}</DialogTitle>
          <DialogDescription>
            {t('professionals.create.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Display name field */}
          <div className="space-y-2">
            <label
              htmlFor="professional-name"
              className="text-sm font-medium text-foreground"
            >
              {t('professionals.create.displayName')}
            </label>
            <Input
              id="professional-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('professionals.create.displayNamePlaceholder')}
              disabled={isSubmitting}
              autoFocus
            />
            {errors.displayName && (
              <p className="text-xs text-red-600">{errors.displayName}</p>
            )}
          </div>

          {/* Email field */}
          <div className="space-y-2">
            <label
              htmlFor="professional-email"
              className="text-sm font-medium text-foreground"
            >
              {t('professionals.create.email')}
            </label>
            <Input
              id="professional-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('professionals.create.emailPlaceholder')}
              disabled={isSubmitting}
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email}</p>
            )}
          </div>

          {/* Send invite checkbox */}
          <div className="flex items-start space-x-3 pt-2">
            <Checkbox
              id="send-invite"
              checked={sendInvite}
              onCheckedChange={(checked) => setSendInvite(checked === true)}
              disabled={isSubmitting}
            />
            <div className="space-y-1">
              <label
                htmlFor="send-invite"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                {t('professionals.create.sendInvite')}
              </label>
              <p className="text-xs text-foreground-muted">
                {t('professionals.create.sendInviteHelp')}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('professionals.create.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !displayName.trim() || !email.trim()}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting
                ? t('professionals.create.submitting')
                : t('professionals.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
