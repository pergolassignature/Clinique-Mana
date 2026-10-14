// LOCAL SCRATCH (never committed): the Paramètres menu at three sizes, and Identité légale.
import fs from 'node:fs'
import path from 'node:path'
import { test } from './fixtures/auth'
import { SEED_ORG, localSql } from './fixtures/db'

const OUT = '/private/tmp/claude-501/-Users-jonathanharvey-Documents-Claude-Projects-Clinique-Mana--claude-worktrees-phase-4-professionals-handoff-6f96d0/ecac7f0f-d28d-4c5b-8b94-43e4f2d34ce7/scratchpad/laneb/settings-menu'
const TAG = process.env.MENU_TAG ?? 'after'
fs.mkdirSync(OUT, { recursive: true })

test('settings menu', async ({ page, signIn }) => {
  test.setTimeout(180_000)
  localSql(`insert into public.org_modules (org_id, module_key, enabled) values ('${SEED_ORG}', 'reports', true)
            on conflict (org_id, module_key) do update set enabled = true;`)
  await signIn('admin')
  for (const [width, height] of [[1440, 900], [1366, 768], [375, 812]] as const) {
    await page.setViewportSize({ width, height })
    for (const where of ['identite', 'quickbooks-clients', 'listes?onglet=motifs']) {
      await page.goto(`/parametres/${where}`)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await page.waitForTimeout(800)
      if (width === 375) {
        await page.getByRole('button', { name: /Section|Réglages|Paramètres/ }).first().click().catch(() => undefined)
        await page.waitForTimeout(400)
      }
      await page.screenshot({ path: path.join(OUT, `${TAG}-${where.replace(/[?=]/g, '_')}-${width}x${height}.png`) })
      if (width !== 375) {
        const nav = page.getByRole('navigation', { name: /Paramètres|Réglages/ }).last()
        await nav.evaluate((el) => {
          const box = el.parentElement
          if (box) box.scrollTop = box.scrollHeight
        }).catch(() => undefined)
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(OUT, `${TAG}-${where.replace(/[?=]/g, '_')}-${width}x${height}-menu-bottom.png`) })
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/parametres/identite')
  await page.waitForTimeout(800)
  await page.getByRole('searchbox', { name: 'Rechercher un réglage' }).fill('paie')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${TAG}-search-paie-1366x768.png`) })
  await page.goto('/parametres/motifs')
  await page.waitForTimeout(1000)
  fs.writeFileSync(path.join(OUT, `${TAG}-redirect.txt`), page.url())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/parametres/identite')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, `${TAG}-identite-full.png`), fullPage: true })
})
