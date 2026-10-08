import { test as base, expect, type Page } from '@playwright/test'
import { ACCOUNTS, SEED_PASSWORD, type AccountKey } from './accounts'
import { E2E_ORIGIN } from './origin'

/**
 * Signs in through the real login page (/connexion), as a user would: no session injected in
 * storage (PS Hub injects one; we test the form and the redirect too). Refuses any origin but the
 * e2e server's, so the seed password is never typed into another site.
 */
async function signIn(page: Page, account: AccountKey): Promise<void> {
  await page.goto('/connexion')
  const origin = new URL(page.url()).origin
  if (origin !== E2E_ORIGIN) throw new Error(`e2e sign-in refused on ${origin}: only ${E2E_ORIGIN} (local seed logins).`)
  await page.getByLabel('Courriel').fill(ACCOUNTS[account].email)
  await page.getByLabel('Mot de passe').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(`${E2E_ORIGIN}/accueil`)
}

export interface AuthFixtures {
  /** Signs `page` in with one of the seed logins and waits for « Accueil ». */
  signIn: (account: AccountKey) => Promise<void>
}

export const test = base.extend<AuthFixtures>({
  signIn: async ({ page }, use) => {
    await use((account) => signIn(page, account))
  },
})

export { expect }
