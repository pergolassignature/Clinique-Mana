import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { matchPath, Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { coreSettingsSections } from '@/core/settings/sections'
import { renderWithContexts } from '@/test/contexts'
import { professionalsManifest } from './index'
import { professionalRecordPage } from './manifest'

const sections = professionalsManifest.settingsSections

describe('professionalsManifest', () => {
  it('uses the English module key and French URLs', () => {
    expect(professionalsManifest.key).toBe('professionals')
    expect(professionalsManifest.dependsOn).toEqual([])
    expect(professionalsManifest.nav).toMatchObject({ path: '/professionnels', permission: 'professionals.view' })
    expect(professionalsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['professionnels', 'professionals.view'],
      ['professionnels/:id/:onglet?', 'professionals.view'],
      ['professionnels/revision-mensuelle', 'professionals.compensation'],
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

  it('shares the record page with the list, which preloads it on row hover', () => {
    expect(professionalsManifest.routes[1]?.component).toBe(professionalRecordPage)
  })

  it('matches the record route with and without a tab', () => {
    const record = professionalsManifest.routes[1]
    if (!record) throw new Error('no record route')
    expect(matchPath(`/${record.path}`, '/professionnels/0b6c/jumelage')?.params).toEqual({ id: '0b6c', onglet: 'jumelage' })
    expect(matchPath(`/${record.path}`, '/professionnels/0b6c')?.params).toMatchObject({ id: '0b6c' })
    expect(matchPath(`/${record.path}`, '/professionnels')).toBeNull()
  })

  it('declares the five list sections of 4a.6–4a.9, « Fiche PDF » (P4-353), then « Rémunération » (4a.18), in the Modules group', () => {
    expect(sections.map((s) => [s.id, s.path])).toEqual([
      ['professions', 'professions'],
      ['clienteles', 'clienteles'],
      ['motifs', 'motifs'],
      ['languages', 'langues'],
      ['deactivation-reasons', 'raisons-desactivation'],
      ['fiche', 'fiche-pdf'],
      ['compensation', 'remuneration'],
    ])
    for (const s of sections) {
      expect(s.group).toBe('modules')
      expect(t(s.labelKey)).not.toBe(s.labelKey)
    }
    for (const s of sections.slice(0, 6)) {
      // Seen by whoever manages the records or the lists; changed only with professionals.settings.
      expect(s.permission).toEqual(['professionals.manage', 'professionals.settings'])
      expect(s.editPermission).toBe('professionals.settings')
    }
  })

  it('opens « Rémunération » to compensation holders, who may also change it', () => {
    const compensation = sections.find((s) => s.id === 'compensation')
    expect(compensation?.permission).toBe('professionals.compensation')
    expect(compensation?.editPermission).toBeUndefined()
  })

  it('has section ids and paths unique against the core sections', () => {
    const ids = [...coreSettingsSections, ...sections].map((s) => s.id)
    const paths = [...coreSettingsSections, ...sections].map((s) => s.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('renders the record page at the record route', async () => {
    const route = professionalsManifest.routes[1]
    if (!route) throw new Error('no route')
    const Page = route.component
    // Not a record id: « introuvable » without a request.
    render(
      renderWithContexts(
        <Routes>
          <Route
            path="/professionnels/:id/:onglet?"
            element={
              <Suspense fallback={null}>
                <Page />
              </Suspense>
            }
          />
        </Routes>,
        { path: '/professionnels/0b6c/apercu' },
      ),
    )
    expect(await screen.findByRole('heading', { level: 1, name: t('modules.professionals.record.notFound.title') })).toBeInTheDocument()
  })
})
