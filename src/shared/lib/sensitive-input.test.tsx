import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from '@/shared/ui/input'
import { SENSITIVE_INPUT_PROPS } from './sensitive-input'

describe('SENSITIVE_INPUT_PROPS', () => {
  it('keeps the browser, password managers, spell check and translators away from the value', () => {
    render(<Input aria-label="NAS" {...SENSITIVE_INPUT_PROPS} />)
    const input = screen.getByRole('textbox', { name: 'NAS' })
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore', 'true')
    expect(input).toHaveAttribute('data-lpignore', 'true')
    expect(input).toHaveAttribute('data-bwignore', 'true')
    expect(input).toHaveAttribute('data-form-type', 'other')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('translate', 'no')
  })
})
