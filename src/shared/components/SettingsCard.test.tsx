import { describe, expect, it, vi } from 'vitest'
import { createPortal } from 'react-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'
import { SaveButton } from './SaveButton'
import { SettingsCard } from './SettingsCard'

function card(props: { readOnly?: boolean; pending?: boolean; onSubmit?: () => void } = {}) {
  return (
    <SettingsCard
      title="Identité"
      description="Le nom de la clinique."
      readOnly={props.readOnly}
      pending={props.pending}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit?.()
      }}
      footer={<SaveButton pending={props.pending} />}
    >
      <Input aria-label="Nom" defaultValue="Clinique MANA" />
    </SettingsCard>
  )
}

describe('SettingsCard', () => {
  it('titles the card with an h3 and shows its description', () => {
    render(card())
    expect(screen.getByRole('heading', { level: 3, name: 'Identité' })).toBeInTheDocument()
    expect(screen.getByText('Le nom de la clinique.')).toBeInTheDocument()
  })

  it('names its form after the title', () => {
    render(card())
    expect(screen.getByRole('form', { name: 'Identité' })).toBeInTheDocument()
  })

  it('marks the form busy while saving, without disabling the fields', () => {
    render(card({ pending: true }))
    expect(screen.getByRole('form', { name: 'Identité' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('group')).toBeEnabled()
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders the footer and submits its form', async () => {
    const onSubmit = vi.fn()
    render(card({ onSubmit }))
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('form', { name: 'Identité' })).not.toHaveAttribute('aria-busy')
  })

  it('read-only: no badge (the page shows one notice), no footer, fields read-only but enabled and focusable', async () => {
    render(card({ readOnly: true }))
    expect(screen.queryByText(t('common.readOnlyNotice.title'))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeEnabled()
    const input = screen.getByRole('textbox', { name: 'Nom' })
    expect(input).toBeEnabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('Clinique MANA')
    await userEvent.tab()
    expect(input).toHaveFocus()
  })

  it('ignores the submit of a form portalled out of it (a dialog), which React bubbles through the tree', async () => {
    const card = vi.fn()
    const dialog = vi.fn()
    render(
      <SettingsCard title="Coordonnées" onSubmit={card} footer={<SaveButton />}>
        {createPortal(
          <form
            aria-label="Dialogue"
            onSubmit={(event) => {
              event.preventDefault()
              dialog()
            }}
          >
            <button type="submit">Enregistrer le dialogue</button>
          </form>,
          document.body,
        )}
      </SettingsCard>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le dialogue' }))
    expect(dialog).toHaveBeenCalledOnce()
    expect(card).not.toHaveBeenCalled()
  })

  it('read-only: never submits, even when Enter submits the form implicitly', async () => {
    const onSubmit = vi.fn()
    render(card({ readOnly: true, onSubmit }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Nom' }), '{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('hands read-only to the fields through FormField, without each field being told', () => {
    render(
      <SettingsCard title="Adresse" readOnly>
        <FormField label="Ville">{(field) => <Input {...field} defaultValue="Laval" />}</FormField>
      </SettingsCard>,
    )
    expect(screen.getByRole('textbox', { name: 'Ville' })).toHaveAttribute('readonly')
  })

  it('inside a read-only area, stays read-only even without its own readOnly (no footer, fields read-only)', () => {
    // E.g. a card rendered inside a read-only panel: the inherited state wins over the default.
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <SettingsCard title="Adresse" footer={<SaveButton />}>
          <FormField label="Ville">{(field) => <Input {...field} defaultValue="Laval" />}</FormField>
        </SettingsCard>
      </FieldsReadOnlyContext.Provider>,
    )
    expect(screen.getByRole('textbox', { name: 'Ville' })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
  })

  it('editable: the fields are not read-only', () => {
    render(
      <SettingsCard title="Adresse">
        <FormField label="Ville">{(field) => <Input {...field} defaultValue="Laval" />}</FormField>
      </SettingsCard>,
    )
    expect(screen.getByRole('textbox', { name: 'Ville' })).not.toHaveAttribute('readonly')
  })

  // A card of actions with no fields (e.g. « Sessions »): a form there would be an empty landmark.
  it('as a section: a region named after the title, with no form', () => {
    render(
      <SettingsCard as="section" title="Sessions" description="Fermez vos sessions." footer={<button type="button">Agir</button>}>
        <p>Contenu</p>
      </SettingsCard>,
    )
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(document.querySelector('form, fieldset')).toBeNull()
    expect(screen.getByText('Contenu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agir' })).toBeInTheDocument()
  })

  it('as a section inside a read-only area: shows its content but not its footer action', () => {
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <SettingsCard as="section" title="Sessions" footer={<button type="button">Agir</button>}>
          <p>Contenu</p>
        </SettingsCard>
      </FieldsReadOnlyContext.Provider>,
    )
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByText('Contenu')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agir' })).not.toBeInTheDocument()
  })
})
