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

  it('makes both buttons inactive (aria-disabled, disabled look) while the form is unchanged, and ignores presses', async () => {
    const { onCancel, onSubmit } = renderActions({ dirty: false })
    for (const button of [cancel(), save()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
      await userEvent.click(button)
    }
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
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
  it('keeps focus on the pressed button once it becomes inactive (after Annuler, while and after saving)', async () => {
    const { rerender } = renderActions()
    await userEvent.click(cancel())
    rerender({ dirty: false })
    expect(cancel()).toHaveFocus()

    rerender({ dirty: true })
    await userEvent.click(save())
    rerender({ dirty: true, pending: true })
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveFocus()
    rerender({ dirty: false })
    expect(save()).toHaveFocus()
  })

  it('calls onReset after onCancel, so the card can move focus to its first field', async () => {
    const calls: string[] = []
    renderActions({ onCancel: () => calls.push('cancel'), onReset: () => calls.push('reset') })
    await userEvent.click(cancel())
    expect(calls).toEqual(['cancel', 'reset'])
  })

  // Design system: « Un seul bouton d'action coloré par écran ». Clean cards show no teal.
  it('draws the submit button outline while the form is clean, teal only while dirty or saving', () => {
    const { rerender } = renderActions({ dirty: false })
    expect(save()).toHaveClass('bg-card')
    expect(save()).not.toHaveClass('bg-primary')
    rerender({ dirty: true })
    expect(save()).toHaveClass('bg-primary')
    rerender({ dirty: true, pending: true })
    expect(screen.getByRole('button', { name: t('common.saving') })).toHaveClass('bg-primary')
    // « Annuler » is always outline.
    expect(cancel()).toHaveClass('bg-card')
    expect(cancel()).not.toHaveClass('bg-primary')
  })

  it('passes another verb to the submit button', () => {
    renderActions({ submitLabel: 'Changer le courriel', pendingLabel: 'Envoi…' })
    expect(screen.getByRole('button', { name: 'Changer le courriel' })).toHaveAttribute('type', 'submit')
  })
})
