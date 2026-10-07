import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SettingsCard } from './SettingsCard'

function card(props: { readOnly?: boolean; onSubmit?: () => void } = {}) {
  return (
    <SettingsCard
      title="Identité"
      description="Le nom de la clinique."
      readOnly={props.readOnly}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit?.()
      }}
      footer={<Button type="submit">{t('common.save')}</Button>}
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

  it('renders the footer and submits its form', async () => {
    const onSubmit = vi.fn()
    render(card({ onSubmit }))
    expect(screen.queryByText(t('common.readOnly'))).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('read-only: shows the badge, hides the footer and disables the fields', () => {
    render(card({ readOnly: true }))
    expect(screen.getByText(t('common.readOnly'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(screen.getByRole('group')).toBeDisabled()
    expect(screen.getByLabelText('Nom')).toBeDisabled()
  })
})
