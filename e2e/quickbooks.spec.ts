import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * QuickBooks (Facturation, FQ part 1; local only, after `npm run db:reset`: the seed stores the
 * fake Intuit's application).
 *
 * 1. Always: without a connection, « QuickBooks » says so and offers « Connecter QuickBooks », and « Clients
 *    QuickBooks » says to connect first.
 * 2. With the fake Intuit (`npm run fake:qbo`) and the functions served: the admin connects the
 *    fake company, sees its accounts suggested (one deposit row per payment mode), the customers'
 *    report, then disconnects so the next run starts as the first. Skipped when the fake does not
 *    answer (CI).
 */

const FAKE_INTUIT = 'http://127.0.0.1:55395'
/** The functions' APP_URL (supabase/functions/.env): where Intuit sends the browser back. */
const APP_ORIGIN = 'http://localhost:5173'

// The seed enables Facturation for the local clinic (billing.settings: the admin, as the template).
test.beforeEach(async ({ signIn }) => {
  await signIn('admin')
})

test('without a connection: « Connecter QuickBooks », and the report says to connect first', async ({ page }) => {
  await page.goto('/parametres/quickbooks')
  await expect(page.getByRole('heading', { level: 1, name: 'QuickBooks' })).toBeVisible()
  await expect(page.getByText('Non connecté')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connecter QuickBooks' })).toBeVisible()
  await page.goto('/parametres/quickbooks-clients')
  await expect(page.getByText(/Connectez d.abord QuickBooks/)).toBeVisible()
})

test('with the fake Intuit: connect, the accounts suggested, the customers matched, then disconnect', async ({ page, request }) => {
  // A probe only (any answer means the fake is up), then a fresh company.
  const up = await request.get(`${FAKE_INTUIT}/connect/oauth2`, { timeout: 2_000 }).then(() => true, () => false)
  test.skip(!up, 'the fake Intuit (npm run fake:qbo) is not running')
  await request.post(`${FAKE_INTUIT}/__fake/reset`)

  await page.goto('/parametres/quickbooks')
  await page.getByRole('button', { name: 'Connecter QuickBooks' }).click()
  await expect(page.getByRole('heading', { name: 'Fausse page de connexion QuickBooks' })).toBeVisible()
  // Intuit's return names the functions' APP_URL (5173, maybe another worktree's server): sent on
  // to this run's own server, same path and query.
  await page.route(`${APP_ORIGIN}/facturation/retour-quickbooks**`, (route) => {
    const back = new URL(route.request().url())
    return route.fulfill({ status: 302, headers: { location: `${E2E_ORIGIN}${back.pathname}${back.search}` } })
  })
  await page.getByRole('button', { name: 'Autoriser' }).click()
  await expect(page.getByText(/est connectée à l.application/)).toBeVisible({ timeout: 60_000 })
  await expect(page).toHaveURL(/\/parametres\/quickbooks$/)
  await expect(page.getByText('Connecté', { exact: true })).toBeVisible()

  // The accounts: suggested from the fake chart; a deposit row per payment mode, none for the credit note.
  await expect(page.getByLabel('Paiements par virement Interac')).not.toHaveValue('')
  await expect(page.getByText('Suggéré').first()).toBeVisible()
  await expect(page.getByLabel(/Note de crédit/)).toHaveCount(0)

  // FQ part 2: the tax codes suggested, and the push paused until the go/no-go.
  await expect(page.getByLabel('Lignes taxables')).not.toHaveValue('')
  await expect(page.getByText('En pause : rien n’est envoyé').or(page.getByText("En pause : rien n'est envoyé"))).toBeVisible()
  await expect(page.getByRole('button', { name: 'Démarrer l’envoi' }).or(page.getByRole('button', { name: "Démarrer l'envoi" }))).toBeEnabled()

  // The customers' report.
  await page.goto('/parametres/quickbooks-clients')
  await expect(page.getByRole('tab', { name: /À décider/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Sans correspondance/ })).toBeVisible()

  // Disconnect, so the next run starts as the first.
  await page.goto('/parametres/quickbooks')
  await page.getByRole('button', { name: 'Déconnecter', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Déconnecter QuickBooks' }).click()
  await expect(page.getByText('QuickBooks est déconnecté.')).toBeVisible()
})
