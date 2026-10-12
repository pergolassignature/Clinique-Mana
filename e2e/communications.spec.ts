import { expect, test } from './fixtures/auth'

/**
 * Communications, CM1 (local only, after `npm run db:reset`: the seed enables the module, stores
 * the fake Google's OAuth client and the Pub/Sub token, and sets a topic). The functions are served
 * with `supabase/functions/.env.example`, whose consent page is the local fake's
 * (`GOOGLE_ACCOUNTS_PUBLIC_URL`): the browser's trip there is intercepted, so the spec needs no
 * fake server. The code exchange itself is covered by the Deno tests (`gmail-callback`).
 */

const FAKE_CONSENT = 'http://127.0.0.1:55392/o/oauth2/v2/auth'

test('the admin sees « Courriels Gmail », saves the topic and leaves for Google with a signed state', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/parametres/courriels-gmail')
  await expect(page.getByRole('heading', { level: 1, name: 'Courriels Gmail' })).toBeVisible()
  await expect(page.getByText("Aucune boîte n'est connectée.")).toBeVisible()
  // The seed's OAuth client: both secrets configured, never shown.
  await expect(page.getByText('Configurée').first()).toBeVisible()
  await expect(page.getByText('local-dev-google-client-secret')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: "Adresse de l'abonnement push" })).toHaveValue(/\/functions\/v1\/gmail-webhook\?org=[0-9a-f-]{36}&token=JETON$/)

  // The topic: a malformed one is refused before the database, a good one saved, then put back.
  const topic = page.getByRole('textbox', { name: /^Sujet Pub\/Sub/ })
  await expect(topic).toHaveValue('projects/mana-local/topics/gmail-push')
  await topic.fill('gmail-push')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Le nom du sujet Pub/Sub doit avoir la forme projects/<projet>/topics/<sujet>.')).toBeVisible()
  await topic.fill('projects/mana-local/topics/gmail-push-2')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Le sujet Pub/Sub est enregistré.')).toBeVisible()
  await page.reload()
  await expect(topic).toHaveValue('projects/mana-local/topics/gmail-push-2')
  await topic.fill('projects/mana-local/topics/gmail-push')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeHidden()

  // « Connecter une boîte »: the browser goes to the consent page with the fixed return address,
  // the two scopes only, offline access and a signed state.
  let consent: URL | null = null
  await page.route(`${FAKE_CONSENT}**`, async (route) => {
    consent = new URL(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>Consentement Google (simulé)</p>' })
  })
  await page.getByRole('button', { name: 'Connecter une boîte' }).click()
  await expect(page.getByText('Consentement Google (simulé)')).toBeVisible()
  expect(consent).not.toBeNull()
  const params = consent!.searchParams
  expect(params.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+\/courriels\/retour-google$/)
  expect(params.get('scope')?.split(' ').sort()).toEqual([
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ])
  expect(params.get('access_type')).toBe('offline')
  expect(params.get('state')).toMatch(/\./)
})

test('a forged return from Google is refused in French', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/courriels/retour-google?code=4%2Ffake&state=forged.state')
  await expect(page.getByRole('heading', { name: "La boîte n'a pas pu être connectée" })).toBeVisible()
  await expect(page.getByText("Le retour de Google n'est pas valide. Recommencez la connexion de la boîte.")).toBeVisible()
  await page.getByRole('link', { name: 'Retour à Courriels Gmail' }).click()
  await expect(page).toHaveURL(/\/parametres\/courriels-gmail$/)
})

test('the conseillère reads the inbox but does not manage the mailboxes', async ({ page, signIn }) => {
  await signIn('counselor')
  await page.goto('/parametres')
  await expect(page.getByRole('link', { name: 'Courriels Gmail' })).toHaveCount(0)
})
