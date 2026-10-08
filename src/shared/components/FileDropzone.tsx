import { useId, useRef, useState, type DragEvent, type Ref } from 'react'
import { Upload } from 'lucide-react'
import { t } from '@/i18n'
import { formatMegabytes, UPLOAD_STEPS, uploadMimeType, type UploadStep } from '@/shared/lib/files'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { ignoreWhenInactive, softDisabledClasses } from './soft-disabled'

interface FileDropzoneProps {
  /** The button that opens the file picker: « Choisir un fichier », « Remplacer »… */
  buttonLabel: string
  /** Under it, and describing it: the formats and size (« PNG ou JPEG, 2 Mo au plus. »). */
  hint: string
  /** The MIME types the purpose accepts (the database's `upload_purposes.mime_types`). */
  accept: readonly string[]
  /** The purpose's size cap, in bytes. */
  maxBytes: number
  /**
   * Uploads the chosen file, declared as `mimeType` (its content's type when the purpose accepts
   * it), reporting each step. A rejection is shown in the zone, worded by `errorMessage`.
   */
  onUpload: (file: File, mimeType: string, onStep: (step: UploadStep) => void) => Promise<void>
  /** The French text of a failed upload (the functions' refusal, a rate limit…). */
  errorMessage: (error: unknown) => string
  /** The button, for a caller that returns focus to it (e.g. after « Retirer »). */
  buttonRef?: Ref<HTMLButtonElement>
  className?: string
}

type State = { status: 'idle' } | { status: 'uploading'; step: UploadStep; name: string } | { status: 'error'; message: string }

/**
 * One file, dropped on the zone or chosen with its button. The size and type are checked here,
 * before any network call (the server stays the authority); then `onUpload` runs, its steps shown
 * as a progress bar with a polite status line, and its error under the button.
 *
 * Keyboard: the button is the one tab stop (Enter or Space opens the picker); the file input is
 * hidden and out of the tab order, and the drop zone is a mouse affordance only. The hint and the
 * error describe the button. While an upload runs, the button is `aria-disabled` (it keeps focus)
 * and a second file is ignored.
 */
export function FileDropzone({ buttonLabel, hint, accept, maxBytes, onUpload, errorMessage, buttonRef, className }: FileDropzoneProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const input = useRef<HTMLInputElement>(null)
  // A ref, not the state: a drop and a change can arrive in the same tick.
  const busy = useRef(false)
  const [state, setState] = useState<State>({ status: 'idle' })
  const [dragActive, setDragActive] = useState(false)
  const uploading = state.status === 'uploading'

  async function handle(file: File | undefined) {
    if (!file || busy.current) return
    busy.current = true
    try {
      if (file.size > maxBytes) {
        setState({ status: 'error', message: t('storage.dropzone.tooLarge', { size: formatMegabytes(maxBytes) }) })
        return
      }
      const mimeType = await uploadMimeType(file, accept)
      if (!accept.includes(mimeType)) {
        setState({ status: 'error', message: t('storage.dropzone.wrongType') })
        return
      }
      setState({ status: 'uploading', step: 'preparing', name: file.name })
      try {
        await onUpload(file, mimeType, (step) => setState({ status: 'uploading', step, name: file.name }))
        setState({ status: 'idle' })
      } catch (error) {
        setState({ status: 'error', message: errorMessage(error) })
      }
    } finally {
      busy.current = false
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!uploading) setDragActive(true)
  }

  const step = uploading ? UPLOAD_STEPS.indexOf(state.step) + 1 : 0
  const stepText = uploading ? t(`storage.dropzone.steps.${state.step}`, { name: state.name }) : ''

  return (
    <div
      data-drag-active={dragActive || undefined}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        void handle(event.dataTransfer.files[0])
      }}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-5 text-center transition-colors',
        'data-[drag-active=true]:border-primary data-[drag-active=true]:bg-primary-soft',
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        accept={accept.join(',')}
        onChange={(event) => {
          void handle(event.currentTarget.files?.[0])
          // The same file can be chosen again (after a refusal, or to retry).
          event.currentTarget.value = ''
        }}
      />
      <Upload aria-hidden className="size-5 text-subtle" />
      <p className="text-sm text-muted-foreground">{t('storage.dropzone.drop')}</p>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-describedby={state.status === 'error' ? `${hintId} ${errorId}` : hintId}
        aria-disabled={uploading || undefined}
        className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        onClick={ignoreWhenInactive(uploading, () => input.current?.click())}
      >
        {buttonLabel}
      </Button>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {uploading && (
        <div className="w-full max-w-xs">
          <div
            role="progressbar"
            aria-label={t('storage.dropzone.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={UPLOAD_STEPS.length}
            aria-valuenow={step}
            aria-valuetext={stepText}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${(step / UPLOAD_STEPS.length) * 100}%` }} />
          </div>
        </div>
      )}
      {/* Always rendered, so each step is announced (a live region must exist before it changes). */}
      <p role="status" className="max-w-full truncate text-xs text-muted-foreground">
        {stepText}
      </p>
      {state.status === 'error' && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </div>
  )
}
