import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { RichEmailEditor } from './RichEmailEditor'

/*
 * The composer's editor is PS Hub's kit (`@pergolas-signature/email-ui/rich-editor`) with MANA's rules.
 * These pin what is MANA's: the words, « Insérer », the StarterKit changes (no heading, blockquotes
 * kept), a template replacing the body through the editor, and the link field refusing what
 * `gmail-send` would strip. The kit's own behaviour is tested in its package.
 */

const C = 'modules.communications.composer'
const body = () => document.querySelector('.ProseMirror') as HTMLElement | null

function editor(props: Partial<Parameters<typeof RichEmailEditor>[0]> = {}) {
  const onChange = vi.fn()
  const view = render(<RichEmailEditor initialHtml="<p>Bonjour</p>" onChange={onChange} label="Message" personKnown {...props} />)
  return { onChange, ...view }
}

describe('RichEmailEditor (the kit, with MANA’s rules)', () => {
  it('draws the kit’s named toolbar in MANA’s words, with « Insérer »', async () => {
    editor()
    const toolbar = await screen.findByRole('toolbar', { name: 'Mise en forme' })
    for (const name of ['Gras', 'Italique', 'Souligné', 'Liste à puces', 'Liste numérotée', 'Lien']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(toolbar).toContainElement(screen.getByRole('button', { name: t(`${C}.insert`) }))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveClass('prose-email')
  })

  it('keeps a reply’s blockquote and turns a heading into a paragraph', async () => {
    editor({ initialHtml: '<h2>Titre</h2><blockquote><p>Le message cité</p></blockquote>' })
    await waitFor(() => expect(body()?.querySelector('blockquote')).toHaveTextContent('Le message cité'))
    expect(body()?.querySelector('h2')).toBeNull()
  })

  it('replaces the body with a template through the editor, so the composer saves what it shows', async () => {
    const { onChange, rerender } = editor()
    await waitFor(() => expect(body()).toHaveTextContent('Bonjour'))
    rerender(
      <RichEmailEditor
        initialHtml="<p>Bonjour</p>"
        replaceWith={{ html: '<h2>Accusé</h2><p>Merci {{person.first_name}}</p>', version: 1 }}
        onChange={onChange}
        label="Message"
        personKnown
      />,
    )
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('<p>Accusé</p><p>Merci {{person.first_name}}</p>'))
    expect(body()).toHaveTextContent('Merci {{person.first_name}}')
  })

  it('refuses a link the send would strip, in MANA’s words', async () => {
    editor()
    fireEvent.click(await screen.findByRole('button', { name: 'Lien' }))
    const field = await screen.findByRole('textbox', { name: 'Lien' })
    fireEvent.change(field, { target: { value: 'ftp://fichiers.test' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`modules.communications.emailUi.richEditor.linkInvalid`))
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })
})
