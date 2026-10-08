import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './input'
import { FieldsReadOnlyContext } from './read-only-context'
import { Textarea } from './textarea'

describe('Input', () => {
  it('shows its placeholder while editable', () => {
    render(<Input aria-label="Site web" placeholder="https://" />)
    expect(screen.getByRole('textbox', { name: 'Site web' })).toHaveAttribute('placeholder', 'https://')
  })

  it('read-only: keeps the value, focusable and unchangeable, and drops the placeholder (it would read as a value)', async () => {
    render(<Input aria-label="Site web" placeholder="https://" readOnly defaultValue="" />)
    const input = screen.getByRole('textbox', { name: 'Site web' })
    expect(input).not.toHaveAttribute('placeholder')
    expect(input).toBeEnabled()
    await userEvent.tab()
    expect(input).toHaveFocus()
    await userEvent.keyboard('abc')
    expect(input).toHaveValue('')
  })

  it('follows the surrounding read-only context (SettingsCard); an explicit readOnly wins', () => {
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <Input aria-label="Ville" />
        <Input aria-label="Recherche" readOnly={false} />
        <Textarea aria-label="Note" />
      </FieldsReadOnlyContext.Provider>,
    )
    expect(screen.getByRole('textbox', { name: 'Ville' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Recherche' })).not.toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('readonly')
  })
})
