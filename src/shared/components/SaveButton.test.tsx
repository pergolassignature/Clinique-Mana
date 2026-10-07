import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { SaveButton } from './SaveButton'

/** Inside a form, to see whether a press submits. */
function renderInForm(props: Parameters<typeof SaveButton>[0] = {}) {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
  const view = render(
    <form onSubmit={onSubmit}>
      <SaveButton {...props} />
    </form>,
  )
  const rerender = (next: Parameters<typeof SaveButton>[0]) =>
    view.rerender(
      <form onSubmit={onSubmit}>
        <SaveButton {...next} />
      </form>,
    )
  return { onSubmit, rerender }
}

describe('SaveButton', () => {
  it('is a submit button reading « Enregistrer »', async () => {
    const { onSubmit } = renderInForm()
    const button = screen.getByRole('button', { name: t('common.save') })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).not.toHaveAttribute('aria-disabled')
    await userEvent.click(button)
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
  it('reads « Enregistrement… » while saving, keeps focus, and ignores presses', async () => {
    const { onSubmit, rerender } = renderInForm()
    const button = screen.getByRole('button', { name: t('common.save') })
    button.focus()
    rerender({ pending: true })
    expect(button).toHaveAccessibleName(t('common.saving'))
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toBeEnabled()
    expect(button).toHaveFocus()
    await userEvent.click(button)
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('can be inactive, e.g. while the form is unchanged, with the disabled look', async () => {
    const { onSubmit } = renderInForm({ disabled: true })
    const button = screen.getByRole('button', { name: t('common.save') })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
    await userEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // Implicit submission (Enter in a text field) clicks the submit button, which ignores it.
  it.each([
    ['unchanged', { disabled: true }],
    ['saving', { pending: true }],
  ] as const)('ignores Enter in a text field while inactive (%s), and submits on Enter once active', async (_label, props) => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const ui = (p: Parameters<typeof SaveButton>[0]) => (
      <form onSubmit={onSubmit}>
        <input aria-label="Nom" />
        <SaveButton {...p} />
      </form>
    )
    const { rerender } = render(ui(props))
    await userEvent.type(screen.getByLabelText('Nom'), 'Camille{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(ui({}))
    await userEvent.type(screen.getByLabelText('Nom'), '{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('is the teal default button unless asked for outline, and keeps its resting fill while inactive', () => {
    const { rerender } = renderInForm({ disabled: true })
    const button = screen.getByRole('button', { name: t('common.save') })
    expect(button).toHaveClass('bg-primary', 'aria-disabled:hover:bg-primary')
    rerender({ disabled: true, variant: 'outline' })
    expect(button).toHaveClass('bg-card', 'border-border', 'aria-disabled:hover:bg-card', 'aria-disabled:hover:border-border')
    expect(button).not.toHaveClass('bg-primary')
  })

  it('can read another verb, with its own pending label', () => {
    const { rerender } = renderInForm({ label: 'Changer le courriel', pendingLabel: 'Envoi…' })
    expect(screen.getByRole('button', { name: 'Changer le courriel' })).not.toHaveAttribute('aria-disabled')
    rerender({ label: 'Changer le courriel', pendingLabel: 'Envoi…', pending: true })
    expect(screen.getByRole('button', { name: 'Envoi…' })).toHaveAttribute('aria-disabled', 'true')
  })
})
