import { expect, test } from './fixtures/auth'
import { forgetDisconnectedMailboxes } from './fixtures/db'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * « Courriels » (CM2; local only, after `npm run db:reset`: the seed enables Communications and
 * stores the fake Google's OAuth client).
 *
 * 1. Always: the admin (the seed gives communications.* to Admin only) finds « Courriels » in the
 *    menu; without a connected mailbox the page says who connects one.
 * 2. With the fake Google (`npm run fake:gmail`) and the functions served (`npx supabase functions
 *    serve --env-file supabase/functions/.env`): the admin connects the fake mailbox (its first
 *    read brings the fictional messages), reads a thread with its attachment, links it to a client
 *    file and unlinks it (CM2b), follows and archives
 *    it, finds it with the search, puts everything back, then disconnects the mailbox; the spec
 *    then removes it (local database), so every other spec starts with no mailbox. Skipped when
 *    the fake does not answer (CI).
 */

const FAKE_GOOGLE = 'http://127.0.0.1:55392'
/** The functions' APP_URL (supabase/functions/.env): where Google sends the browser back. */
const APP_ORIGIN = 'http://localhost:5173'

// Each test starts from the seed's state (no mailbox) and the run leaves it so: a mailbox left
// disconnected by an earlier run is removed before, and the one this spec connects after.
test.beforeEach(() => forgetDisconnectedMailboxes())
test.afterAll(() => forgetDisconnectedMailboxes())

test('the admin finds « Courriels »; without a mailbox the page says who connects one', async ({ page, signIn }) => {
  await signIn('admin')
  await page.getByRole('link', { name: 'Courriels' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Courriels' })).toBeVisible()
  await expect(page.getByText('Aucune boîte connectée')).toBeVisible()
  await expect(page.getByText('Une personne qui gère les boîtes les connecte dans Paramètres, section « Courriels Gmail ».')).toBeVisible()
})

test('with the fake Google: read, follow, archive and search a thread, then put everything back', async ({ page, signIn, request }) => {
  // A probe only (any answer means the fake is up): no reset, its message ids stay those the
  // database mirrors, and the test puts back what it changes.
  const up = await request.get(`${FAKE_GOOGLE}/__fake/ping`, { timeout: 2_000 }).then(() => true, () => false)
  test.skip(!up, 'the fake Google (npm run fake:gmail) is not running')

  await signIn('admin')
  await page.goto('/parametres/courriels-gmail')
  await page.getByRole('button', { name: 'Connecter une boîte' }).click()
  await expect(page.getByRole('heading', { name: 'Fausse page de consentement Google' })).toBeVisible()
  // Google's return names the functions' APP_URL (5173, maybe another worktree's server): sent
  // on to this run's own server, same path and query.
  await page.route(`${APP_ORIGIN}/courriels/retour-google**`, (route) => {
    const back = new URL(route.request().url())
    return route.fulfill({ status: 302, headers: { location: `${E2E_ORIGIN}${back.pathname}${back.search}` } })
  })
  await page.getByRole('button', { name: 'Autoriser' }).click()
  await expect(page.getByText('La boîte info@clinique.test est connectée.')).toBeVisible({ timeout: 60_000 })

  await page.goto('/courriels')
  const list = page.getByRole('list', { name: 'Conversations' })
  const thread = list.getByRole('button', { name: /Attestation pour mes assurances/ })
  await expect(thread).toBeVisible()
  await expect(list.getByRole('button', { name: /Annulation de mon rendez-vous de jeudi/ })).toBeVisible()

  // The thread: the subject takes the focus, the attachment opens through a signed address.
  await thread.click()
  await expect(page).toHaveURL(/[?&]fil=[0-9a-f-]{36}/)
  const subject = page.getByRole('heading', { level: 2, name: 'Attestation pour mes assurances' })
  await expect(subject).toBeFocused()
  await expect(page.getByText(/pourriez-vous m’envoyer une attestation/)).toBeVisible()
  const attachment = page.getByRole('link', { name: /formulaire-assurance\.pdf/ })
  await expect(attachment).toHaveAttribute('href', /\/storage\/v1\/object\/sign\//)

  // CM2b: no file has the sender's address; link the thread to Camille (the seed's file), see it
  // leave « À rattacher », then « Détacher » (a person's choice: the next runs start the same).
  const file = page.getByRole('group', { name: 'Dossier client' })
  await expect(file.getByText('Aucun dossier client rattaché.')).toBeVisible()
  await file.getByRole('button', { name: 'Rattacher à un dossier' }).click()
  await page.getByLabel('Chercher un dossier').fill('Camille')
  await page.getByRole('list', { name: 'Dossiers trouvés' }).getByRole('button', { name: /Camille Exemple/ }).click()
  await expect(page.getByText('Courriel rattaché au dossier.')).toBeVisible()
  await expect(file.getByRole('link', { name: /CLI-\d{6} · Camille Exemple/ })).toHaveAttribute('href', /\/clients\/[0-9a-f-]{36}$/)
  await page.getByRole('navigation', { name: 'Boîtes et dossiers' }).getByRole('button', { name: 'À rattacher' }).click()
  await expect(list.getByRole('button', { name: /Annulation de mon rendez-vous de jeudi/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /Attestation pour mes assurances/ })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Boîtes et dossiers' }).getByRole('button', { name: /Boîte de réception/ }).click()
  await list.getByRole('button', { name: /Attestation pour mes assurances/ }).click()
  await file.getByRole('button', { name: 'Détacher' }).click()
  await expect(file.getByText('Aucun dossier client rattaché.')).toBeVisible()

  // Follow, then stop following: Gmail first, the mirror after.
  await page.getByRole('button', { name: 'Suivre', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ne plus suivre' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Boîtes et dossiers' }).getByRole('button', { name: 'Suivis' }).click()
  await expect(list.getByRole('button', { name: /Attestation pour mes assurances/ })).toBeVisible()
  await list.getByRole('button', { name: /Attestation pour mes assurances/ }).click()
  await page.getByRole('button', { name: 'Ne plus suivre' }).click()
  await expect(page.getByRole('button', { name: 'Suivre', exact: true })).toBeVisible()

  // Archive: out of the inbox; the search still finds it; back to the inbox.
  await page.getByRole('navigation', { name: 'Boîtes et dossiers' }).getByRole('button', { name: /Boîte de réception/ }).click()
  await list.getByRole('button', { name: /Attestation pour mes assurances/ }).click()
  await page.getByRole('button', { name: 'Archiver' }).click()
  await expect(page.getByRole('button', { name: 'Remettre dans la boîte de réception' })).toBeVisible()
  await expect(list.getByRole('button', { name: /Attestation pour mes assurances/ })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Rechercher dans les courriels' }).fill('attestation')
  await expect(list.getByRole('button', { name: /Attestation pour mes assurances/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /Annulation de mon rendez-vous/ })).toHaveCount(0)
  await list.getByRole('button', { name: /Attestation pour mes assurances/ }).click()
  await page.getByRole('button', { name: 'Remettre dans la boîte de réception' }).click()
  await expect(page.getByRole('button', { name: 'Archiver' })).toBeVisible()

  // CM3: « Répondre », a template-free text, « Envoyer », five seconds, sent through the fake Gmail
  // and mirrored at once in the thread.
  await page.getByRole('button', { name: 'Répondre', exact: true }).click()
  const composer = page.getByRole('dialog', { name: /Attestation pour mes assurances/ })
  await expect(composer.getByLabel('À', { exact: true })).toHaveValue('macote@example.test')
  const editor = composer.getByRole('textbox', { name: 'Message' })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('Bonjour, voici votre attestation. ')
  await composer.getByRole('button', { name: 'Envoyer' }).click()
  await expect(composer.getByText(/Envoi dans \d s\./)).toBeVisible()
  await expect(page.getByText('Courriel envoyé.')).toBeVisible({ timeout: 20_000 })
  await expect(composer).toHaveCount(0)
  // The reply is in the thread at once (mirrored by gmail-send), from the clinic.
  await expect(page.getByRole('article', { name: /Clinique MANA/ })).toBeVisible()

  // Disconnect, so the next run starts as the first.
  await page.goto('/parametres/courriels-gmail')
  await page.getByRole('button', { name: 'Déconnecter', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Déconnecter la boîte' }).click()
  await expect(page.getByText('La boîte est déconnectée.')).toBeVisible()
})
