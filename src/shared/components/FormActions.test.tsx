import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FormActions } from './FormActions'

/** Inside a form, as in a SettingsCard footer. */
function renderActions(props: Partial<Parameters<typeof FormActions>[0]> = {}) {
  const onCancel = vi.fn()
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <FormActions onCancel={onCancel} dirty {...props} />
    </form>,
  )
  return { onCancel, onSubmit }
}

const cancel = () => screen.getByRole('button', { name: t('common.cancel') })

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
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('disables both buttons while the form is unchanged', () => {
    renderActions({ dirty: false })
    expect(cancel()).toBeDisabled()
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled()
  })

  it('disables both buttons while saving', () => {
    renderActions({ pending: true })
    expect(cancel()).toBeDisabled()
    expect(screen.getByRole('button', { name: t('common.saving') })).toBeDisabled()
  })

  it('passes another verb to the submit button', () => {
    renderActions({ submitLabel: 'Changer le courriel', pendingLabel: 'Envoi…' })
    expect(screen.getByRole('button', { name: 'Changer le courriel' })).toHaveAttribute('type', 'submit')
  })
})
