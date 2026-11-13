import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { LoadError } from '@/shared/components/LoadState'
import type { MailConnection } from '../../api/mailboxes'
import { useDraft } from '../../hooks/use-composer'
import { ComposerContext, type ComposeRequest } from '../../hooks/use-composer-launcher'
import { Composer } from './Composer'

interface ComposerHostProps {
  /** The mailboxes the person may send from (connected). */
  mailboxes: MailConnection[]
  /** After a send: the page may open the thread. */
  onSent?: (threadId: string | null) => void
  children: ReactNode
}

/**
 * Holds the page's composer (PS Hub mounts one for the whole app; here each host page —
 * « Courriels », a record's « Courriels » — holds its own): `useComposerLauncher().open(…)` shows
 * it, docked at the bottom right on a computer, full screen on a phone. One at a time: opening
 * another replaces it (its draft is saved first). Once it closes (the X, « Supprimer le brouillon »,
 * the send), the focus goes back to what opened it.
 */
export function ComposerHost({ mailboxes, onSent, children }: ComposerHostProps) {
  const [request, setRequest] = useState<{ value: ComposeRequest; key: number } | null>(null)
  // What had the focus when the composer opened: « Répondre », the thread's title for R or F, a
  // draft's row, « Nouveau message ».
  const opener = useRef<HTMLElement | null>(null)
  const launcher = useMemo(
    () => ({
      open: (value: ComposeRequest) => {
        const active = document.activeElement
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null
        setRequest((prev) => ({ value, key: (prev?.key ?? 0) + 1 }))
      },
      isOpen: request !== null,
    }),
    [request],
  )
  const close = () => setRequest(null)
  // The composer gone, the focus it held (or its confirmation's) has fallen to the page: it goes back
  // to the opener. Not when the person has put it elsewhere meanwhile (a row clicked during the five
  // seconds), nor when the opener is gone too (a draft's row, once sent or deleted).
  useEffect(() => {
    if (request !== null || opener.current === null) return
    const back = opener.current
    opener.current = null
    const active = document.activeElement
    if (back.isConnected && (active === null || active === document.body)) back.focus()
  }, [request])
  return (
    <ComposerContext.Provider value={launcher}>
      {children}
      {request && (
        <OpenComposer
          key={request.key}
          request={request.value}
          mailboxes={mailboxes}
          onClose={close}
          onSent={(threadId) => {
            close()
            onSent?.(threadId)
          }}
        />
      )}
    </ComposerContext.Provider>
  )
}

function OpenComposer({
  request,
  mailboxes,
  onClose,
  onSent,
}: {
  request: ComposeRequest
  mailboxes: MailConnection[]
  onClose: () => void
  onSent: (threadId: string | null) => void
}) {
  const draft = useDraft(request.kind === 'draft' ? request.draftId : null)
  if (request.kind === 'content') {
    return (
      <Composer
        draftId={null}
        initial={request.content}
        mailboxes={mailboxes}
        fileLabel={request.fileLabel}
        personKnown={request.personKnown}
        onClose={onClose}
        onSent={onSent}
      />
    )
  }
  if (draft.isPending) return null
  if (!draft.data) {
    return (
      <div role="alert" className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-border bg-card p-3 shadow-large">
        <LoadError message={t('modules.communications.composer.draftGone')} retrying={draft.isFetching} onRetry={() => void draft.refetch()} />
        <button type="button" className="mt-2 text-sm text-link underline-offset-[3px] hover:underline" onClick={onClose}>
          {t('modules.communications.composer.close')}
        </button>
      </div>
    )
  }
  const { id, connectionId, mode, threadId, replyToMessageId, clientId, to, cc, bcc, subject, bodyHtml, attachments } = draft.data
  const content = { connectionId, mode, threadId, replyToMessageId, clientId, to, cc, bcc, subject, bodyHtml, attachments }
  return (
    <Composer
      draftId={id}
      initial={content}
      mailboxes={mailboxes}
      fileLabel={request.fileLabel}
      personKnown={request.personKnown || content.clientId !== null}
      onClose={onClose}
      onSent={onSent}
    />
  )
}
