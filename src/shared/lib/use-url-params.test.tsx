import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { ROUTER_FUTURE } from './router-future'
import { patchParams, useUrlParams } from './use-url-params'

let api: ReturnType<typeof useUrlParams> & { navigate: ReturnType<typeof useNavigate>; rerender: () => void }

/** Suspends while the address holds `attente` and `release` has not been called (a page whose data is loading). */
let release: () => void = () => {}
let held: Promise<void> | null = null
function Waiting({ search }: { search: string }) {
  if (search.includes('attente') && held) throw held
  return null
}

function Probe() {
  const url = useUrlParams()
  const navigate = useNavigate()
  const [, setTick] = useState(0)
  api = { ...url, navigate, rerender: () => setTick((n) => n + 1) }
  return (
    <>
      <p data-testid="search">{url.params.toString()}</p>
      <Waiting search={url.params.toString()} />
    </>
  )
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
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

  it('a change while the previous one is still pending (its render suspended, then an urgent re-render of the old address) keeps both', async () => {
    held = new Promise<void>((resolve) => {
      release = () => {
        held = null
        resolve()
      }
    })
    renderAt('/liste?tri=recents&dernier=jamais')
    // The navigation is a transition (v7_startTransition): its render suspends, the old address stays on screen.
    act(() => api.update({ dernier: null, attente: '1' }))
    expect(screen.getByTestId('search')).toHaveTextContent(/^tri=recents&dernier=jamais$/)
    // Something else re-renders the page meanwhile (a list's data arriving): still the old address;
    // the next change comes before the navigation renders again, and is built on the latest address.
    act(() => {
      flushSync(() => api.rerender())
      api.update({ vue: 'jour' })
    })
    await act(async () => release())
    expect(screen.getByTestId('search')).toHaveTextContent(/^tri=recents&attente=1&vue=jour$/)
  })

  it('patchParams leaves its base untouched', () => {
    const base = new URLSearchParams('a=1')
    expect(patchParams(base, { b: '2', a: null }).toString()).toBe('b=2')
    expect(base.toString()).toBe('a=1')
  })
})
