import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/auth'

/**
 * The shell's height (local only, after `npm run db:reset`): on a long page the window scrolls the
 * content only; the sidebar fills the window's height and keeps its footer (the signed-in user) in
 * view, the top bar stays put, and the document ends where the shell does. A Demandes record's
 * « Accueil » tab broke it: Radix's hidden checkbox inputs in its scrolling motifs list lengthened
 * the document past the shell, so the sidebar and its footer scrolled away (AppShell's `main`).
 */

async function openDemande(page: Page) {
  await page.goto('/demandes')
  await expect(page.getByRole('heading', { level: 1, name: 'Demandes' })).toBeVisible()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  await dialog.getByRole('textbox', { name: 'Nom' }).fill('Lucie Hauteur')
  await dialog.getByRole('textbox', { name: 'Téléphone' }).fill('514 555-0199')
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page).toHaveURL(/\/demandes\/[0-9a-f-]{36}\/accueil$/)
  // The long part of the tab: the motifs list (a scrolling list of checkboxes).
  await expect(page.getByRole('checkbox').first()).toBeAttached()
}

/** Scrolls the window to the end, then measures the shell against the window. */
async function scrollToEnd(page: Page) {
  return page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    const shell = document.querySelector('aside')!.parentElement!.getBoundingClientRect()
    const aside = document.querySelector('aside')!.getBoundingClientRect()
    return {
      windowHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      shellHeight: Math.round(shell.height),
      asideTop: aside.top,
      asideBottom: aside.bottom,
      headerTop: document.querySelector('header')!.getBoundingClientRect().top,
    }
  })
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`on a long page the sidebar and the top bar stay in view, at ${size.width}×${size.height}`, async ({ page, signIn }) => {
    await page.setViewportSize(size)
    await signIn('admin')
    await openDemande(page)
    const user = page.locator('aside').getByRole('button', { name: 'Se déconnecter' })
    for (const path of [null, '/parametres/journal']) {
      if (path) await page.goto(path)
      await page.waitForLoadState('networkidle')
      const m = await scrollToEnd(page)
      expect(m.documentHeight, path ?? 'demande').toBe(m.shellHeight)
      expect(m.asideTop).toBe(0)
      expect(m.asideBottom).toBe(m.windowHeight)
      expect(m.headerTop).toBe(0)
      await expect(user).toBeInViewport()
    }
  })
}

test('on the phone layout the document ends with the shell and the top bar stays', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await signIn('admin')
  await openDemande(page)
  await page.waitForLoadState('networkidle')
  const m = await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    return {
      documentHeight: document.documentElement.scrollHeight,
      shellHeight: Math.round(document.querySelector('header')!.parentElement!.parentElement!.getBoundingClientRect().height),
      headerTop: document.querySelector('header')!.getBoundingClientRect().top,
    }
  })
  expect(m.documentHeight).toBe(m.shellHeight)
  expect(m.headerTop).toBe(0)
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Se déconnecter' })).toBeInViewport()
})
