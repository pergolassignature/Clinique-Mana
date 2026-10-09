import { useEffect, useState, type ComponentProps, type ComponentType } from 'react'
import type { EmbedSignDocument } from '@documenso/embed-react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { SigningLink } from '../../api/consent-sign'

const S = 'modules.professionals.consentSign'
type EmbedSignDocumentProps = ComponentProps<typeof EmbedSignDocument>

/**
 * How long the frame may take to say it is ready before the page offers the signing page itself:
 * a frame refused by Documenso's `frame-ancestors` / `X-Frame-Options` (or our `frame-src`), a
 * license gate or a network error never posts `document-ready`.
 */
export const READY_TIMEOUT_MS = 8_000

/**
 * Documenso's signing page inside ours (P4-488): `@documenso/embed-react` `EmbedSignDocument`
 * (pinned 0.6.2), loaded in its own chunk when this mounts (never with the login page, nor before
 * « Signer le consentement »). `onDocumentCompleted` → `onCompleted` (the sync). If the frame does
 * not signal ready within `READY_TIMEOUT_MS`, or errs, « Ouvrir la page de signature » leads to the
 * full page in this window (Documenso brings her back, `redirectUrl`); that link also stays under
 * the frame. The token is a credential: it comes from the parent's state and goes nowhere else.
 */
export function EmbeddedSigning({ link, onCompleted, onClose }: { link: SigningLink; onCompleted: () => void; onClose: () => void }) {
  const [Embed, setEmbed] = useState<ComponentType<EmbedSignDocumentProps> | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')

  useEffect(() => {
    let live = true
    import('@documenso/embed-react')
      .then((module) => live && setEmbed(() => module.EmbedSignDocument))
      .catch(() => live && setState('fallback'))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (state !== 'loading') return
    const timer = window.setTimeout(() => setState((s) => (s === 'loading' ? 'fallback' : s)), READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  const openPage = (
    <a href={link.signingUrl} className="text-link underline-offset-[3px] hover:underline">
      {t(`${S}.openInPage`)}
    </a>
  )

  return (
    <div className="space-y-2">
      {state === 'fallback' ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{t(`${S}.fallback`)}</p>
            <Button asChild size="sm">
              <a href={link.signingUrl}>{t(`${S}.openPage`)}</a>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {state === 'loading' && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`${S}.loading`)}
            </p>
          )}
          {Embed && (
            <div
              // The component renders a bare iframe: it is named here (screen readers announce frames by title).
              ref={(node) => node?.querySelector('iframe')?.setAttribute('title', t(`${S}.frameTitle`))}
              className="w-full overflow-hidden rounded-md border border-border [&>iframe]:block [&>iframe]:h-[75vh] [&>iframe]:min-h-[520px] [&>iframe]:w-full">
              <Embed
                host={link.host}
                token={link.token}
                language="fr"
                onDocumentReady={() => setState('ready')}
                onDocumentCompleted={() => onCompleted()}
                onDocumentError={() => setState('fallback')}
              />
            </div>
          )}
        </>
      )}
      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {state !== 'fallback' && (
          <span>
            {t(`${S}.notShowing`)} {openPage}
          </span>
        )}
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onClose}>
          {t(`${S}.close`)}
        </Button>
      </p>
    </div>
  )
}
