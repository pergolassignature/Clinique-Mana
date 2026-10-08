import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './checkbox'
import { FieldsReadOnlyContext } from './read-only-context'
import { Switch } from './switch'

// Checkbox and Switch in a read-only SettingsCard: like the text fields, never disabled. They say
// they are read-only, stay focusable at full contrast, and ignore every way of toggling them.
describe.each([
  ['Checkbox', Checkbox, 'checkbox'],
  ['Switch', Switch, 'switch'],
] as const)('%s', (_name, Control, role) => {
  it('toggles normally when editable', async () => {
    const onCheckedChange = vi.fn()
    render(<Control aria-label="Actif" defaultChecked={false} onCheckedChange={onCheckedChange} />)
    const control = screen.getByRole(role)
    expect(control).not.toHaveAttribute('aria-readonly')
    await userEvent.click(control)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(control).toBeChecked()
  })

  it('read-only from the context: aria-readonly, enabled, focusable, and click / Space / Enter change nothing', async () => {
    const onCheckedChange = vi.fn()
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <Control aria-label="Actif" defaultChecked onCheckedChange={onCheckedChange} />
      </FieldsReadOnlyContext.Provider>,
    )
    const control = screen.getByRole(role)
    expect(control).toHaveAttribute('aria-readonly', 'true')
    expect(control).toBeEnabled()
    await userEvent.tab()
    expect(control).toHaveFocus()
    await userEvent.click(control)
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')
    expect(control).toBeChecked()
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('read-only when controlled too, and an explicit readOnly={false} wins over the context', async () => {
    const onCheckedChange = vi.fn()
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <Control aria-label="Contrôlé" checked={false} onCheckedChange={onCheckedChange} />
        <Control aria-label="Modifiable" readOnly={false} defaultChecked={false} />
      </FieldsReadOnlyContext.Provider>,
    )
    await userEvent.click(screen.getByRole(role, { name: 'Contrôlé' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(screen.getByRole(role, { name: 'Contrôlé' })).not.toBeChecked()
    const editable = screen.getByRole(role, { name: 'Modifiable' })
    expect(editable).not.toHaveAttribute('aria-readonly')
    await userEvent.click(editable)
    expect(editable).toBeChecked()
  })
})
