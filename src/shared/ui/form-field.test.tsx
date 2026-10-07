import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { FormField } from './form-field'
import { Input } from './input'

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

  it('shows « (requis) » in the label, for everyone, instead of a bare asterisk', () => {
    render(
      <FormField label="Nom" required>
        {(field) => <Input {...field} />}
      </FormField>,
    )
    const input = screen.getByLabelText(`Nom ${t('common.form.required')}`)
    const label = document.querySelector(`label[for="${input.id}"]`)
    expect(label).not.toHaveTextContent('*')
    const marker = screen.getByText(t('common.form.required'))
    expect(marker).not.toHaveClass('sr-only')
    expect(marker).toHaveClass('font-normal', 'text-muted-foreground')
  })
})
