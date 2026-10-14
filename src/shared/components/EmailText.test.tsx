import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EmailText } from './EmailText'

describe('EmailText', () => {
  it('reads as the address, with break points after « @ » and before each dot only', () => {
    const { container } = render(<EmailText value="ines.fictive@exemple.test" className="block" />)
    const span = container.firstElementChild!
    expect(span).toHaveTextContent('ines.fictive@exemple.test')
    expect(span).toHaveClass('break-words', 'block')
    expect(span.innerHTML).toBe('ines<wbr>.fictive@<wbr>exemple<wbr>.test')
  })
})
