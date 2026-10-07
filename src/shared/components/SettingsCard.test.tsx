import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { Input } from '@/shared/ui/input'
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
    expect(screen.getByRole('button', { name: t('common.saving') })).toBeDisabled()
  })

  it('renders the footer and submits its form', async () => {
    const onSubmit = vi.fn()
    render(card({ onSubmit }))
    expect(screen.queryByText(t('common.readOnly'))).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('form', { name: 'Identité' })).not.toHaveAttribute('aria-busy')
  })

  it('read-only: shows the badge, hides the footer and disables the fields', () => {
    render(card({ readOnly: true }))
    expect(screen.getByText(t('common.readOnly'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeDisabled()
    expect(screen.getByLabelText('Nom')).toBeDisabled()
  })
})
