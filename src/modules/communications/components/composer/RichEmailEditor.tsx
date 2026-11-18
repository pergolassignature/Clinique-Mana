import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { StarterKitOptions } from '@tiptap/starter-kit'
import { Braces } from 'lucide-react'
import { ComposerUiProvider } from '@pergolas-signature/email-ui/composer'
import { RichEmailEditor as KitEditor } from '@pergolas-signature/email-ui/rich-editor'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { COMPOSE_PLACEHOLDERS } from '../../api/composer'
import { COMPOSER_UI_PORTS } from './composer-ui-ports'

const C = 'modules.communications.composer'

/** What a link may point to: what `gmail-send` keeps (`_shared/gmail/compose.ts`), so the editor never holds a link the send would strip. */
const LINK_SCHEMES = /^(https?:|mailto:|tel:|cid:)/i

/**
 * MANA's changes to the kit's StarterKit set: no headings, and blockquotes kept, because a reply carries
 * the quoted message in its body. Each key replaces the kit's.
 */
const STARTER_KIT: Partial<StarterKitOptions> = {
  heading: false,
  blockquote: {},
  link: {
    openOnClick: false,
    autolink: true,
    protocols: ['mailto'],
    defaultProtocol: 'https',
    isAllowedUri: (url, ctx) => LINK_SCHEMES.test(url) && ctx.defaultValidate(url),
  },
}

/** The body's typography: MANA's `.prose-email` (no typography plugin here). */
const BODY_CLASS = 'prose-email min-h-40 px-3 py-2 text-sm text-foreground'

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
 * The composer's editor: PS Hub's (`@pergolas-signature/email-ui/rich-editor`), with MANA's rules. Bold,
 * italic, underline, lists and links (the kit's toolbar and link field, which refuses what `gmail-send`
 * would strip), and « Insérer » for the placeholders the server fills (`{{person.first_name}}`…). No
 * image, no HTML pasted as is: the schema keeps what it knows, and `gmail-send` hardens what it receives.
 */
export function RichEmailEditor({ initialHtml, replaceWith, onChange, label, personKnown }: RichEmailEditorProps) {
  const [html, setHtml] = useState(initialHtml)
  const editor = useRef<Editor | null>(null)

  useEffect(() => {
    const current = editor.current
    if (!current || !replaceWith) return
    // Through the editor, not the kit's value: the composer then saves what the editor kept (a template's
    // heading becomes a paragraph here, and must not be sent as a heading).
    current.commands.setContent(replaceWith.html, { emitUpdate: true })
    current.commands.focus('end')
    // Only a new version replaces the text (the same template twice is two versions).
  }, [replaceWith?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ComposerUiProvider ports={COMPOSER_UI_PORTS}>
      <div className="rounded-md border border-border bg-card px-1 pt-1 focus-within:ring-2 focus-within:ring-ring">
        <KitEditor
          valueHtml={html}
          onChange={(value) => {
            setHtml(value.html)
            onChange(value.html)
          }}
          placeholder={t(`${C}.bodyPlaceholder`)}
          label={label}
          starterKit={STARTER_KIT}
          bodyClassName={BODY_CLASS}
          editorRef={editor}
          toolbarExtras={(kitEditor) => <InsertMenu editor={kitEditor} personKnown={personKnown} />}
        />
      </div>
    </ComposerUiProvider>
  )
}

/** « Insérer »: the placeholders the server fills at the send; a person's need a linked file. */
function InsertMenu({ editor, personKnown }: { editor: Editor; personKnown: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="ml-1 h-8 gap-1 px-2">
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
  )
}
