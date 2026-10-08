import { useId } from 'react'
import { Copy } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/sonner'

interface WebhookAddressFieldProps {
  /** The address the provider posts its events to. */
  url: string
  label: string
  /** Where to paste it. */
  help: string
}

/**
 * A webhook address to give a provider (Resend, Documenso): read-only, with « Copier ». Everyone
 * who sees the section may copy it: it only routes events, the function checks their signature.
 */
export function WebhookAddressField({ url, label, help }: WebhookAddressFieldProps) {
  const id = useId()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('settings.webhook.copied'))
    } catch {
      toast.error(t('settings.webhook.copyError'))
    }
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input id={id} readOnly value={url} aria-describedby={`${id}-help`} spellCheck={false} className="min-w-0 flex-1" />
        <Button type="button" variant="outline" onClick={() => void copy()} className="max-sm:h-11">
          <Copy aria-hidden className="size-3.5" />
          {t('settings.webhook.copy')}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </p>
    </div>
  )
}
