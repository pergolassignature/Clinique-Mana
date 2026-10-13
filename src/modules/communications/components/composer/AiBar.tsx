import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { aiErrorMessage, type AiDraft, type AiDraftMode } from '../../api/ai'
import { useAiDraft } from '../../hooks/use-ai'

const A = 'modules.communications.ai'

export interface AiBarProps {
  /** A reply offers « Générer une réponse » too. */
  replying: boolean
  /** The editor's text above the quote, as plain text. */
  draftText: string
  /** The message replied to, as plain text ('' for a new message). */
  originalText: string
  subjectEmpty: boolean
  clientId: string | null
  threadId: string | null
  /** The month's cap is reached: the button says so. */
  capReached: boolean
  disabled: boolean
  onUse: (draft: { text: string; subject: string | null }) => void
}

/**
 * « Rédiger avec l'IA » (CM4), PS Hub's bar taken as is (CM-18): « Rédiger avec l'IA » opens a box
 * for the instruction (Entrée sends, Maj+Entrée goes to the line, Échap closes); in a reply,
 * « Générer une réponse » writes one at once. The proposal shows above the editor (« Objet proposé »
 * when the subject is empty) with « Utiliser » (it replaces the text above the quote), « Annuler »
 * (nothing changes) and « Raffiner » (an instruction more, in the same conversation). The server
 * hides the names and numbers from OpenAI and gives them back.
 */
export function AiBar({ replying, draftText, originalText, subjectEmpty, clientId, threadId, capReached, disabled, onUse }: AiBarProps) {
  const id = useId()
  const draft = useAiDraft()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<AiDraft | null>(null)
  const [refining, setRefining] = useState(false)
  const [refinement, setRefinement] = useState('')
  const [error, setError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const busy = draft.isPending

  const run = (mode: AiDraftMode, text: string) => {
    if (busy) return
    setError(null)
    draft.mutate(
      {
        mode,
        instruction: text,
        draft: draftText,
        original: originalText,
        subjectEmpty,
        clientId,
        threadId,
        history: mode === 'refine' ? (proposal?.history ?? []) : [],
      },
      {
        onSuccess: (result) => {
          setProposal(result)
          setOpen(false)
          setInstruction('')
          setRefining(false)
          setRefinement('')
        },
        onError: (failure) => setError(aiErrorMessage(failure)),
      },
    )
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, send: () => void, close: () => void) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  const clear = () => {
    setProposal(null)
    setRefining(false)
    setRefinement('')
    setError(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || capReached}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
            setTimeout(() => promptRef.current?.focus(), 0)
          }}
          className="max-sm:h-11"
        >
          {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Sparkles aria-hidden className="size-3.5" />}
          {t(`${A}.write`)}
        </Button>
        {replying && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || busy || capReached} onClick={() => run('reply', '')} className="max-sm:h-11">
            {t(`${A}.reply`)}
          </Button>
        )}
        {capReached && <span className="text-xs text-muted-foreground">{t(`${A}.capReached`)}</span>}
        {busy && (
          <span role="status" className="text-xs text-muted-foreground">
            {t(`${A}.writing`)}
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2">
          <Label htmlFor={`${id}-prompt`}>{t(`${A}.promptLabel`)}</Label>
          <div className="flex items-end gap-2">
            <Textarea
              id={`${id}-prompt`}
              ref={promptRef}
              rows={2}
              value={instruction}
              maxLength={2000}
              placeholder={t(`${A}.promptPlaceholder`)}
              disabled={busy}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => onKey(event, () => instruction.trim() && run(replying ? 'reply' : 'write', instruction.trim()), () => setOpen(false))}
            />
            <Button
              type="button"
              size="sm"
              aria-label={t(`${A}.send`)}
              disabled={busy || !instruction.trim()}
              onClick={() => run(replying ? 'reply' : 'write', instruction.trim())}
              className="h-9 w-9 p-0"
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t(`${A}.promptHelp`)}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {proposal && (
        <section aria-label={t(`${A}.proposal`)} className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2">
          {proposal.subject && (
            <p className="text-xs text-muted-foreground">
              {t(`${A}.proposedSubject`)} <span className="font-medium text-foreground">{proposal.subject}</span>
            </p>
          )}
          <p className={busy ? 'whitespace-pre-wrap text-sm opacity-50' : 'whitespace-pre-wrap text-sm'}>{proposal.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                onUse({ text: proposal.text, subject: proposal.subject })
                clear()
              }}
            >
              {t(`${A}.use`)}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clear}>
              {t(`${A}.reject`)}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} aria-expanded={refining} onClick={() => setRefining((value) => !value)}>
              {t(`${A}.refine`)}
            </Button>
          </div>
          {refining && (
            <div className="flex items-end gap-2">
              <Textarea
                aria-label={t(`${A}.refineLabel`)}
                rows={1}
                autoFocus
                value={refinement}
                maxLength={2000}
                placeholder={t(`${A}.refinePlaceholder`)}
                disabled={busy}
                onChange={(event) => setRefinement(event.target.value)}
                onKeyDown={(event) => onKey(event, () => refinement.trim() && run('refine', refinement.trim()), () => setRefining(false))}
              />
              <Button
                type="button"
                size="sm"
                aria-label={t(`${A}.refineSend`)}
                disabled={busy || !refinement.trim()}
                onClick={() => run('refine', refinement.trim())}
                className="h-9 w-9 p-0"
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
