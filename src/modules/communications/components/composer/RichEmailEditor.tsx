import { useEffect, useId, useState, type FormEvent } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Braces, Italic, Link as LinkIcon, List, ListOrdered, Unlink } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { COMPOSE_PLACEHOLDERS } from '../../api/composer'

const C = 'modules.communications.composer'

interface RichEmailEditorProps {
  /** The HTML to start from (a draft, a quote); later changes come from the editor only. */
  initialHtml: string
  /** A new starting text from outside (a template applied): replaces the content when it changes. */
  replaceWith?: { html: string; version: number } | null
  onChange: (html: string) => void
  /** The editor's accessible name. */
  label: string
  /** Whether the person may insert the file's placeholders (a file is linked). */
  personKnown: boolean
}

/**
 * The composer's editor (TipTap, as PS Hub's `RichEmailEditor`): paragraphs, bold, italic, lists,
 * links (https and mailto only), and « Insérer » for the placeholders the server fills
 * (`{{person.first_name}}`…). No image, no HTML pasted as is: the schema keeps what it knows, and
 * `gmail-send` hardens what it receives.
 */
export function RichEmailEditor({ initialHtml, replaceWith, onChange, label, personKnown }: RichEmailEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: true, protocols: ['mailto'], defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder: t(`${C}.bodyPlaceholder`) }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'prose-email min-h-40 px-3 py-2 text-sm text-foreground outline-none',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })

  useEffect(() => {
    if (editor && replaceWith) {
      editor.commands.setContent(replaceWith.html, { emitUpdate: true })
      editor.commands.focus('end')
    }
    // Only a new version replaces the text (the same template twice is two versions).
  }, [editor, replaceWith?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            link: e.isActive('link'),
          }
        : null,
  })

  if (!editor) return null
  const toggle = (active: boolean | undefined, run: () => void, text: string, Icon: typeof Bold) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active ?? false}
      aria-label={text}
      title={text}
      onClick={run}
      className={cn('h-8 w-8 p-0', active && 'bg-muted text-foreground')}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  )
  return (
    <div className="rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring">
      <div role="toolbar" aria-label={t(`${C}.toolbar`)} className="flex flex-wrap items-center gap-0.5 border-b border-border-light px-1 py-1">
        {toggle(state?.bold, () => editor.chain().focus().toggleBold().run(), t(`${C}.bold`), Bold)}
        {toggle(state?.italic, () => editor.chain().focus().toggleItalic().run(), t(`${C}.italic`), Italic)}
        {toggle(state?.bullet, () => editor.chain().focus().toggleBulletList().run(), t(`${C}.bulletList`), List)}
        {toggle(state?.ordered, () => editor.chain().focus().toggleOrderedList().run(), t(`${C}.orderedList`), ListOrdered)}
        <LinkButton
          active={state?.link ?? false}
          onSet={(href) => editor.chain().focus().extendMarkRange('link').setLink({ href }).run()}
          onUnset={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          currentHref={() => (editor.getAttributes('link').href as string | undefined) ?? ''}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2">
              <Braces aria-hidden className="size-4" />
              {t(`${C}.insert`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t(`${C}.insertHint`)}</DropdownMenuLabel>
            {COMPOSE_PLACEHOLDERS.map((path) => {
              const needsFile = path.startsWith('person.')
              return (
                <DropdownMenuItem
                  key={path}
                  disabled={needsFile && !personKnown}
                  onSelect={() => editor.chain().focus().insertContent(`{{${path}}}`).run()}
                >
                  {t(`${C}.placeholders.${path.replace('.', '_') as 'person_first_name'}`)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

/** « Lien »: an address for the selection (https or mailto), or « Retirer le lien ». */
function LinkButton({
  active,
  onSet,
  onUnset,
  currentHref,
}: {
  active: boolean
  onSet: (href: string) => void
  onUnset: () => void
  currentHref: () => string
}) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const submit = (event: FormEvent) => {
    // The popover is portalled, but its submit still bubbles through React to the composer's form.
    event.preventDefault()
    event.stopPropagation()
    const value = href.trim()
    const normalized = /^(https?:\/\/|mailto:)/i.test(value) ? value : `https://${value}`
    if (!/^(https?:\/\/[^\s<>"]+\.[^\s<>"]+|mailto:[^\s<>"]+@[^\s<>"]+)$/i.test(normalized)) {
      setError(t(`${C}.linkInvalid`))
      return
    }
    onSet(normalized)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setHref(currentHref())
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={active}
          aria-label={t(`${C}.link`)}
          title={t(`${C}.link`)}
          className={cn('h-8 w-8 p-0', active && 'bg-muted text-foreground')}
        >
          <LinkIcon aria-hidden className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={submit} className="space-y-2" noValidate>
          <Label htmlFor={id}>{t(`${C}.linkAddress`)}</Label>
          <Input
            id={id}
            value={href}
            autoFocus
            autoComplete="off"
            placeholder="https://"
            aria-invalid={error !== null || undefined}
            onChange={(event) => setHref(event.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onUnset()
                  setOpen(false)
                }}
              >
                <Unlink aria-hidden className="size-3.5" />
                {t(`${C}.unlink`)}
              </Button>
            )}
            <Button type="submit" size="sm">
              {t(`${C}.linkApply`)}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
