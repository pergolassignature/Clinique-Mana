import type { Page } from '@playwright/test'
import { ACCOUNTS, SEED_PASSWORD } from './fixtures/accounts'
import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * Modules reserved for testers (R-72; local only, after `npm run db:reset`: the seed enables
 * Services et tarifs). The admin reserves the module and lists the adjointe: she keeps
 * « Services et tarifs » in Paramètres, while the admin, not listed, loses it; then the admin
 * removes her and opens the module to everyone again. The opening runs in `finally`, so a failed
 * step never leaves the module reserved for the next specs.
 */

const RESERVED = 'Services et tarifs : réservé aux testeurs'

/** Back to the seed's state: no tester, open to everyone. */
async function reopen(page: Page) {
  await page.goto('/parametres/modules')
  const remove = page.getByRole('button', { name: 'Retirer Adjointe Locale des testeurs' })
  if (await remove.isVisible().catch(() => false)) {
    await remove.click()
    await expect(page.getByText('Testeur retiré.')).toBeVisible()
  }
  const reserved = page.getByRole('switch', { name: RESERVED })
  if ((await reserved.getAttribute('aria-checked')) === 'true') {
    await reserved.click()
    await expect(reserved).not.toBeChecked()
  }
}

test('the admin reserves Services et tarifs for the adjointe, then opens it again', async ({ page, signIn, browser }) => {
  await signIn('admin')
  try {
    await page.goto('/parametres/modules')
    const reserved = page.getByRole('switch', { name: RESERVED })
    await expect(reserved).not.toBeChecked()
    await reserved.click()
    // An enabled module: everyone else loses it at once, so it asks first.
    const confirm = page.getByRole('alertdialog', { name: 'Réserver Services et tarifs aux testeurs ?' })
    await confirm.getByRole('button', { name: 'Réserver aux testeurs' }).click()
    await expect(page.getByText('Accès au module mis à jour.')).toBeVisible()
    await expect(reserved).toBeChecked()
    await expect(page.getByText('Personne ne voit ce module : ajoutez au moins un testeur.')).toBeVisible()
    await page.getByLabel('Ajouter un testeur…').selectOption({ label: 'Adjointe Locale (Adjointe administrative)' })
    await expect(page.getByText('Testeur ajouté.')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Testeurs de Services et tarifs' }).getByText('Adjointe Locale')).toBeVisible()

    // The admin is not listed: the section is gone for her.
    await page.goto('/parametres')
    await expect(page.getByRole('link', { name: 'Services et tarifs' })).toHaveCount(0)

    // The adjointe, a tester, still has it.
    const other = await browser.newContext({ baseURL: E2E_ORIGIN, locale: 'fr-CA' })
    try {
      const adjointe = await other.newPage()
      await adjointe.goto('/connexion')
      await adjointe.getByLabel('Courriel').fill(ACCOUNTS.adminAssistant.email)
      await adjointe.getByLabel('Mot de passe').fill(SEED_PASSWORD)
      await adjointe.getByRole('button', { name: 'Se connecter' }).click()
      await expect(adjointe).toHaveURL(/\/accueil$/)
      await adjointe.goto('/parametres/services-et-tarifs')
      await expect(adjointe.getByRole('heading', { level: 1, name: 'Services et tarifs' })).toBeVisible()
    } finally {
      await other.close()
    }
  } finally {
    await reopen(page)
  }
  await page.goto('/parametres')
  await expect(page.getByRole('link', { name: 'Services et tarifs' })).toBeVisible()
})
