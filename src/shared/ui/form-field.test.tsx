import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FormField, FormRow } from './form-field'
import { Input } from './input'
import { FieldsReadOnlyContext } from './read-only-context'

describe('FormField', () => {
  it('associates the label with the control', () => {
    render(<FormField label="Ville">{(field) => <Input {...field} />}</FormField>)
    const input = screen.getByLabelText('Ville')
    expect(input.tagName).toBe('INPUT')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('links the help text through aria-describedby', () => {
    render(
      <FormField label="NEQ" help="10 chiffres, sur votre avis du Registraire.">
        {(field) => <Input {...field} />}
      </FormField>,
    )
    expect(screen.getByLabelText('NEQ')).toHaveAccessibleDescription('10 chiffres, sur votre avis du Registraire.')
  })

  it('links the error too and marks the control invalid, without an alert per field', () => {
    render(
      <FormField label="NEQ" help="10 chiffres." error="Le NEQ compte 10 chiffres.">
        {(field) => <Input {...field} />}
      </FormField>,
    )
    const input = screen.getByLabelText('NEQ')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('10 chiffres. Le NEQ compte 10 chiffres.')
    expect(screen.getByText('Le NEQ compte 10 chiffres.')).toBeVisible()
    // react-hook-form focuses the first invalid field, whose description reads the error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('marks a required field with a teal asterisk for sight and « (requis) » for screen readers', () => {
    render(
      <FormField label="Nom" required>
        {(field) => <Input {...field} />}
      </FormField>,
    )
    // The accessible name skips the aria-hidden asterisk and reads the sr-only « (requis) ».
    const input = screen.getByRole('textbox', { name: `Nom ${t('common.form.required')}` })
    const label = document.querySelector(`label[for="${input.id}"]`)
    const asterisk = within(label as HTMLElement).getByText('*')
    expect(asterisk).toHaveAttribute('aria-hidden', 'true')
    expect(within(label as HTMLElement).getByText(t('common.form.required'))).toHaveClass('sr-only')
  })

  it('adds no marker to an optional field', () => {
    render(<FormField label="Ville">{(field) => <Input {...field} />}</FormField>)
    expect(screen.getByRole('textbox', { name: 'Ville' })).toBeInTheDocument()
    expect(screen.queryByText('*')).not.toBeInTheDocument()
    expect(screen.queryByText(t('common.form.required'))).not.toBeInTheDocument()
  })

  it('read-only: hands readOnly to the control, which stays focusable and enabled, without the required marker', async () => {
    render(
      <FormField label="NEQ" help="10 chiffres." required readOnly>
        {(field) => <Input {...field} defaultValue="1234567890" />}
      </FormField>,
    )
    // No « (requis) »: nothing to fill in a field that cannot be changed.
    const input = screen.getByRole('textbox', { name: 'NEQ' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toBeEnabled()
    expect(input).toHaveAccessibleDescription('10 chiffres.')
    expect(screen.queryByText('*')).not.toBeInTheDocument()
    await userEvent.tab()
    expect(input).toHaveFocus()
  })

  it('read-only from the surrounding context (SettingsCard), unless the field says otherwise', () => {
    render(
      <FieldsReadOnlyContext.Provider value={true}>
        <FormField label="Ville">{(field) => <Input {...field} />}</FormField>
        <FormField label="Note" readOnly={false}>
          {(field) => <Input {...field} />}
        </FormField>
      </FieldsReadOnlyContext.Provider>,
    )
    expect(screen.getByRole('textbox', { name: 'Ville' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Note' })).not.toHaveAttribute('readonly')
  })

  it('editable by default: no readOnly prop on the control', () => {
    render(<FormField label="Ville">{(field) => <Input {...field} />}</FormField>)
    expect(screen.getByRole('textbox', { name: 'Ville' })).not.toHaveAttribute('readonly')
  })

  it('without width it is a plain block, as before (no width class)', () => {
    render(<FormField label="Ville">{(field) => <Input {...field} />}</FormField>)
    const wrapper = screen.getByText('Ville').parentElement!
    expect(wrapper.className).toBe('space-y-1')
  })

  it.each([
    ['xs', 'w-field-xs'],
    ['sm', 'w-field-sm'],
    ['md', 'w-field-md'],
    ['full', 'w-full'],
  ] as const)('width="%s" sizes the whole field (%s), never wider than its column', (width, cls) => {
    render(
      <FormField label="Code postal" width={width} help="A1A 1A1">
        {(field) => <Input {...field} />}
      </FormField>,
    )
    const wrapper = screen.getByText('Code postal').closest('div')!
    expect(wrapper).toHaveClass(cls, 'max-w-full', 'min-w-0')
    expect(wrapper).toContainElement(screen.getByText('A1A 1A1'))
  })

  it('FormRow puts fields that belong together on one wrapping line, 12 px apart', () => {
    render(
      <FormRow>
        <FormField label="Ville" width="md">{(field) => <Input {...field} />}</FormField>
        <FormField label="Code postal" width="xs">{(field) => <Input {...field} />}</FormField>
      </FormRow>,
    )
    const row = screen.getByText('Ville').parentElement!.parentElement!
    expect(row).toHaveClass('flex', 'flex-wrap', 'gap-3', 'items-start')
  })
})
