import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { t } from '@/i18n'
import { professionalsManifest } from './index'

describe('professionalsManifest', () => {
  it('uses the English module key and French URLs', () => {
    expect(professionalsManifest.key).toBe('professionals')
    expect(professionalsManifest.dependsOn).toEqual([])
    expect(professionalsManifest.nav).toMatchObject({ path: '/professionnels', permission: 'professionals.view' })
    expect(professionalsManifest.routes.map((r) => [r.path, r.permission])).toEqual([['professionnels', 'professionals.view']])
  })

  it('has route paths relative to the app root', () => {
    for (const route of professionalsManifest.routes) expect(route.path.startsWith('/')).toBe(false)
  })

  it('renders the placeholder page', async () => {
    const route = professionalsManifest.routes[0]
    if (!route) throw new Error('no route')
    const Page = route.component
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    )
    expect(await screen.findByText(t('modules.professionals.placeholder'))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t('modules.professionals.name') })).toBeInTheDocument()
  })
})
