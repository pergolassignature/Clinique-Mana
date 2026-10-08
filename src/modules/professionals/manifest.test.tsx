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
    expect(professionalsManifest.nav).toEqual([
      expect.objectContaining({ path: '/professionnels', permission: 'professionals.view', order: 10 }),
      // « Mon profil » right after Accueil, for professionals only (P4-361).
      expect.objectContaining({ path: '/mon-profil', permission: 'professionals.self', hiddenWith: 'professionals.view', order: 5 }),
    ])
    expect(professionalsManifest.routes.map((r) => [r.path, r.permission])).toEqual([
      ['professionnels', 'professionals.view'],
      ['professionnels/:id/:onglet?', 'professionals.view'],
      ['professionnels/revision-mensuelle', 'professionals.compensation'],
      ['mon-profil', 'professionals.self'],
      ['mon-profil/questionnaire', 'professionals.self'],
    ])
    expect(professionalsManifest.homeCards?.map((c) => [c.id, c.permission])).toEqual([['professionals-profile', 'professionals.self']])
  })

  it('has route paths relative to the app root', () => {
    for (const route of professionalsManifest.routes) expect(route.path.startsWith('/')).toBe(false)
  })

  it('code-splits every route, section and Accueil card (each can be preloaded)', () => {
    for (const page of [...professionalsManifest.routes, ...sections, ...(professionalsManifest.homeCards ?? [])].map((x) => x.component)) {
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

  it('declares the five list sections of 4a.6–4a.9, « Invitations » (4b.3), then « Rémunération » (4a.18), in the Modules group', () => {
    expect(sections.map((s) => [s.id, s.path])).toEqual([
      ['professions', 'professions'],
      ['clienteles', 'clienteles'],
      ['motifs', 'motifs'],
      ['languages', 'langues'],
      ['deactivation-reasons', 'raisons-desactivation'],
      ['invitations', 'invitations'],
      ['compensation', 'remuneration'],
    ])
    for (const s of sections) {
      expect(s.group).toBe('modules')
      expect(t(s.labelKey)).not.toBe(s.labelKey)
    }
    for (const s of sections.slice(0, 5)) {
      // Seen by whoever manages the records or the lists; changed only with professionals.settings.
      expect(s.permission).toEqual(['professionals.manage', 'professionals.settings'])
      expect(s.editPermission).toBe('professionals.settings')
    }
  })

  it('opens « Invitations » to whoever invites, changed with professionals.settings', () => {
    const invitations = sections.find((s) => s.id === 'invitations')
    expect(invitations?.permission).toEqual(['professionals.invite', 'professionals.settings'])
    expect(invitations?.editPermission).toBe('professionals.settings')
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
    // The page's chunk is transformed on first import (cold, under load: over a second).
    expect(await screen.findByRole('heading', { level: 1, name: t('modules.professionals.record.notFound.title') }, { timeout: 10_000 })).toBeInTheDocument()
  })
})
