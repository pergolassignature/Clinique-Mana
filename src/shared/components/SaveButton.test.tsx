import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { SaveButton } from './SaveButton'

describe('SaveButton', () => {
  it('is a submit button reading « Enregistrer »', () => {
    render(<SaveButton />)
    const button = screen.getByRole('button', { name: t('common.save') })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeEnabled()
  })

  it('reads « Enregistrement… » and cannot be pressed again while saving', () => {
    render(<SaveButton pending />)
    expect(screen.getByRole('button', { name: t('common.saving') })).toBeDisabled()
  })

  it('can be disabled, e.g. while the form is unchanged', () => {
    render(<SaveButton disabled />)
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled()
  })

  it('can read another verb, with its own pending label', () => {
    const { rerender } = render(<SaveButton label="Changer le courriel" pendingLabel="Envoi…" />)
    expect(screen.getByRole('button', { name: 'Changer le courriel' })).toBeEnabled()
    rerender(<SaveButton label="Changer le courriel" pendingLabel="Envoi…" pending />)
    expect(screen.getByRole('button', { name: 'Envoi…' })).toBeDisabled()
  })
})
