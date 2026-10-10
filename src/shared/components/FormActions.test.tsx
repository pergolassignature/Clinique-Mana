import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FormActions } from './FormActions'

type Props = Parameters<typeof FormActions>[0]

/** Inside a form, as in a SettingsCard footer. */
function renderActions(props: Partial<Props> = {}) {
  const onCancel = vi.fn()
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
  const ui = (next: Partial<Props>) => (
    <form onSubmit={onSubmit}>
      <FormActions onCancel={onCancel} dirty {...next} />
    </form>
  )
  const view = render(ui(props))
  return { onCancel, onSubmit, rerender: (next: Partial<Props>) => view.rerender(ui(next)) }
}

const cancel = () => screen.getByRole('button', { name: t('common.cancel') })
const save = () => screen.getByRole('button', { name: t('common.save') })

describe('FormActions', () => {
  it('shows « Annuler » then « Enregistrer », in that order', () => {
    renderActions()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t('common.cancel'), t('common.save')])
  })

  it('« Annuler » resets through onCancel without submitting the form', async () => {
    const { onCancel, onSubmit } = renderActions()
    await userEvent.click(cancel())
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('« Enregistrer » submits the form', async () => {
    const { onSubmit } = renderActions()
    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  // Decision UI-2: a clean form shows no buttons at all.
  it('renders nothing while the form is unchanged and not saving', () => {
    renderActions({ dirty: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes both buttons inactive while saving', async () => {
    const { onCancel, onSubmit } = renderActions({ pending: true })
    expect(cancel()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(cancel())
    await userEvent.click(screen.getByRole('button', { name: t('common.saving') }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // A disabled button would drop keyboard focus to <body> (WCAG 2.4.3).
  it('keeps focus on the pressed button while saving (aria-disabled, never disabled)', async () => {
    const { rerender } = renderActions()
    await userEvent.click(save())
    rerender({ dirty: true, pending: true })
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveFocus()
  })

  // The buttons disappear with the form clean: focus goes to the form's title, never to <body>.
  it('moves focus to the form title when the buttons disappear with focus on them (after a save, after Annuler)', async () => {
    const ui = (dirty: boolean, pending = false) => (
      <form aria-labelledby="titre" onSubmit={(e) => e.preventDefault()}>
        <h3 id="titre">Identité</h3>
        <input aria-label="Nom" />
        <FormActions onCancel={() => undefined} dirty={dirty} pending={pending} />
      </form>
    )
    const view = render(ui(true))
    await userEvent.click(save())
    view.rerender(ui(true, true))
    view.rerender(ui(false))
    const title = screen.getByRole('heading', { name: 'Identité' })
    expect(title).toHaveFocus()
    expect(title).toHaveAttribute('tabindex', '-1')

    view.rerender(ui(true))
    await userEvent.click(cancel())
    view.rerender(ui(false))
    expect(title).toHaveFocus()
  })

  it('leaves focus alone when it was elsewhere', async () => {
    const ui = (dirty: boolean) => (
      <form aria-labelledby="titre2">
        <h3 id="titre2">Identité</h3>
        <input aria-label="Nom" />
        <FormActions onCancel={() => undefined} dirty={dirty} />
      </form>
    )
    const view = render(ui(true))
    await userEvent.click(screen.getByRole('textbox', { name: 'Nom' }))
    view.rerender(ui(false))
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveFocus()
  })

  it('calls onReset after onCancel, so the card can move focus to its first field', async () => {
    const calls: string[] = []
    renderActions({ onCancel: () => calls.push('cancel'), onReset: () => calls.push('reset') })
    await userEvent.click(cancel())
    expect(calls).toEqual(['cancel', 'reset'])
  })

  // Design system: « Un seul bouton d'action coloré par écran »: a shown « Enregistrer » is teal.
  it('draws the submit button teal while dirty or saving; « Annuler » is always outline', () => {
    const { rerender } = renderActions({ dirty: true })
    expect(save()).toHaveClass('bg-primary')
    rerender({ dirty: true, pending: true })
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveClass('bg-primary')
    expect(cancel()).toHaveClass('bg-card')
    expect(cancel()).not.toHaveClass('bg-primary')
  })

  // An edit mode opened by « Modifier » (Coordonnées bancaires): « Annuler » leaves it, edits or not.
  it('with cancelCloses, shows the buttons while clean, « Annuler » active (inactive only while saving), and skips onReset', async () => {
    const onReset = vi.fn()
    const { onCancel, rerender } = renderActions({ dirty: false, cancelCloses: true, onReset })
    expect(cancel()).not.toHaveAttribute('aria-disabled')
    expect(save()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(cancel())
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onReset).not.toHaveBeenCalled()
    rerender({ dirty: true, pending: true, cancelCloses: true, onReset })
    expect(cancel()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(cancel())
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('passes another verb to the submit button', () => {
    renderActions({ submitLabel: 'Changer le courriel', pendingLabel: 'Envoi…' })
    expect(screen.getByRole('button', { name: 'Changer le courriel' })).toHaveAttribute('type', 'submit')
  })
})
