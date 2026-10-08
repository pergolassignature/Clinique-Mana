import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { matchPath } from 'react-router-dom'
import { t } from '@/i18n'
import { coreSettingsSections } from '@/core/settings/sections'
import { professionalsManifest } from './index'

const sections = professionalsManifest.settingsSections

describe('professionalsManifest', () => {
  it('uses the English module key and French URLs', () => {
    expect(professionalsManifest.key).toBe('professionals')
    expect(professionalsManifest.dependsOn).toEqual([])
    expect(professionalsManifest.nav).toMatchObject({ path: '/professionnels', permission: 'professionals.view' })
    expect(professionalsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['professionnels', 'professionals.view'],
      ['professionnels/:id/:onglet?', 'professionals.view'],
    ])
  })

  it('has route paths relative to the app root', () => {
    for (const route of professionalsManifest.routes) expect(route.path.startsWith('/')).toBe(false)
  })

  it('code-splits every route and section (each can be preloaded)', () => {
    for (const page of [...professionalsManifest.routes, ...sections].map((x) => x.component)) {
      expect(typeof page.preload).toBe('function')
      expect(typeof page.isLoaded).toBe('function')
    }
  })

  it('matches the record route with and without a tab', () => {
    const record = professionalsManifest.routes[1]
    if (!record) throw new Error('no record route')
    expect(matchPath(`/${record.path}`, '/professionnels/0b6c/jumelage')?.params).toEqual({ id: '0b6c', onglet: 'jumelage' })
    expect(matchPath(`/${record.path}`, '/professionnels/0b6c')?.params).toMatchObject({ id: '0b6c' })
    expect(matchPath(`/${record.path}`, '/professionnels')).toBeNull()
  })

  it('declares the five list sections of 4a.6–4a.9 in the Modules group', () => {
    expect(sections.map((s) => [s.id, s.path])).toEqual([
      ['professions', 'professions'],
      ['specialties', 'specialites'],
      ['motifs', 'motifs'],
      ['languages', 'langues'],
      ['deactivation-reasons', 'raisons-desactivation'],
    ])
    for (const s of sections) {
      expect(s.group).toBe('modules')
      // Seen by whoever manages the records or the lists; changed only with professionals.settings.
      expect(s.permission).toEqual(['professionals.manage', 'professionals.settings'])
      expect(s.editPermission).toBe('professionals.settings')
      expect(t(s.labelKey)).not.toBe(s.labelKey)
    }
  })

  it('has section ids and paths unique against the core sections', () => {
    const ids = [...coreSettingsSections, ...sections].map((s) => s.id)
    const paths = [...coreSettingsSections, ...sections].map((s) => s.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('renders the placeholder page until 4a.10', async () => {
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

  it('renders the settings placeholder until 4a.9', async () => {
    const section = sections.find((s) => s.id === 'motifs')
    if (!section) throw new Error('no section')
    const Page = section.component
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    )
    expect(await screen.findByText(t('modules.professionals.settingsPlaceholder'))).toBeInTheDocument()
  })
})
