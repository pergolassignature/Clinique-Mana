import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { patchParams, useUrlParams } from './use-url-params'

let api: ReturnType<typeof useUrlParams> & { navigate: ReturnType<typeof useNavigate> }

function Probe() {
  const url = useUrlParams()
  const navigate = useNavigate()
  api = { ...url, navigate }
  return <p data-testid="search">{url.params.toString()}</p>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  )
}

describe('useUrlParams', () => {
  it('two changes in a row both apply (each built on the latest address, not the render)', () => {
    renderAt('/liste?tri=nom')
    act(() => {
      api.update({ pour: 'moi' })
      api.update({ filtres: 'en-retard' })
    })
    expect(screen.getByTestId('search')).toHaveTextContent('tri=nom&pour=moi&filtres=en-retard')
  })

  it('null or empty removes a parameter; the others stay', () => {
    renderAt('/liste?tri=nom&pour=moi')
    act(() => api.update({ pour: null, q: '' }))
    expect(screen.getByTestId('search')).toHaveTextContent(/^tri=nom$/)
  })

  it('a new address (a link, Back) replaces the latest one', () => {
    renderAt('/liste?tri=nom')
    act(() => api.navigate('/liste?vue=fermees'))
    act(() => api.update({ pour: 'moi' }))
    expect(screen.getByTestId('search')).toHaveTextContent(/^vue=fermees&pour=moi$/)
  })

  it('patchParams leaves its base untouched', () => {
    const base = new URLSearchParams('a=1')
    expect(patchParams(base, { b: '2', a: null }).toString()).toBe('b=2')
    expect(base.toString()).toBe('a=1')
  })
})
