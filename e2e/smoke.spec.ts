import { ACCOUNTS } from './fixtures/accounts'
import { expect, test } from './fixtures/auth'

test('an admin signs in, lands on « Accueil », and signs out', async ({ page, signIn }) => {
  await signIn('admin')

  await expect(page).toHaveTitle('Accueil · Clinique MANA')
  const breadcrumb = page.getByRole('navigation', { name: "Fil d'Ariane" })
  await expect(breadcrumb.getByText('Accueil')).toHaveAttribute('aria-current', 'page')

  await page.getByRole('button', { name: `Menu de ${ACCOUNTS.admin.name}` }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
})
