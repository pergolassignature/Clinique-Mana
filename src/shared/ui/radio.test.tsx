import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Radio } from './radio'

function Pair() {
  const [value, setValue] = useState('oui')
  return (
    <fieldset>
      {['oui', 'non'].map((v) => (
        <label key={v}>
          <Radio name="choix" value={v} checked={value === v} onChange={() => setValue(v)} />
          {v}
        </label>
      ))}
    </fieldset>
  )
}

describe('Radio', () => {
  it('is a native radio drawn by us: teal when checked, never the browser’s accent colour', () => {
    render(<Radio aria-label="Oui" defaultChecked />)
    const radio = screen.getByRole('radio', { name: 'Oui' })
    expect(radio).toHaveAttribute('type', 'radio')
    expect(radio.className).toContain('appearance-none')
    expect(radio.className).toContain('checked:bg-primary')
    expect(radio.className).not.toContain('accent-')
  })

  it('works as a group: its label checks it, the other one unchecks', async () => {
    render(<Pair />)
    await userEvent.click(screen.getByText('non'))
    expect(screen.getByRole('radio', { name: 'non' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'oui' })).not.toBeChecked()
  })
})
