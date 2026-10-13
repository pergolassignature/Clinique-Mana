/**
 * Shared harness of the Stripe functions' tests (Facturation FS): a fake
 * Stripe on `http://stripe.test`, a mail sink, and the service routes the
 * functions call, each overridable. Test-only.
 */
import type { Deps } from '../deps.ts'
import { accessFixture, emailContextFixture, ORG_ID } from './email-fixtures.ts'
import {
  FAKE_STRIPE_SECRET_KEY,
  FAKE_STRIPE_WEBHOOK_SECRET,
  fakeStripe,
} from './fake-stripe.ts'
import { fakeSupabase, type RpcRoute } from './fake-supabase.ts'
import { fixedClock } from './fixed-clock.ts'

export const STRIPE_TEST_ORIGIN = 'http://stripe.test'
export const NOW = '2026-11-03T15:00:00Z'
export const PAYER = '00000000-0000-4000-8000-0000000000c1'
export const INVOICE = '00000000-0000-4000-8000-0000000000f1'
export const CHARGE = '00000000-0000-4000-8000-0000000000e1'
export { FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET, ORG_ID }

export interface StripeHarnessOptions {
  rpc?: Record<string, RpcRoute>
  permissions?: string[]
  modules?: string[]
  secretKey?: string | null
  moduleOpen?: boolean
}

export function stripeHarness(opts: StripeHarnessOptions = {}) {
  const stripe = fakeStripe({ publicOrigin: 'http://127.0.0.1:55397' })
  const mails: Request[] = []
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
      },
      module_enabled_for_org: { data: true },
      list_job_orgs: { data: [ORG_ID] },
      start_job_run: { data: 'run-1' },
      finish_job_run: { data: null },
      get_org_secret: (args) => ({
        data: args.p_key === 'stripe_secret_key'
          ? (opts.secretKey === undefined
            ? FAKE_STRIPE_SECRET_KEY
            : opts.secretKey)
          : args.p_key === 'stripe_webhook_secret'
          ? FAKE_STRIPE_WEBHOOK_SECRET
          : null,
      }),
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'billing',
          module_open: opts.moduleOpen ?? true,
          template: {
            key: String(args.p_template_key),
            subject: 'Carte — {{clinic.name}}',
            body: 'Bonjour {{recipient.first_name}}.',
            button_label: 'Enregistrer ma carte',
            view_permission: 'billing.view',
            variables: ['recipient.first_name', 'clinic.name'].map((path) => ({
              path,
              label: path,
              sample: 'x',
              required: true,
              kind: 'text',
            })),
          },
        }),
      }),
      queue_email: { data: '00000000-0000-4000-8000-000000000800' },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
      claim_webhook_event: {
        data: [{
          status: 'claimed',
          id: '00000000-0000-4000-8000-000000000900',
          claim_token: '00000000-0000-4000-8000-000000000901',
        }],
      },
      complete_webhook_event: { data: true },
      fail_webhook_event: { data: true },
      ...opts.rpc,
    },
  })
  const user = fakeSupabase({
    user: { id: '00000000-0000-4000-8000-0000000000a1' },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(
            opts.permissions ?? ['billing.view', 'billing.manage'],
          ),
          modules: opts.modules ?? ['billing'],
        },
      },
    },
  })
  const fetchAll: typeof fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.origin === STRIPE_TEST_ORIGIN) return await stripe.handler(req)
    if (url.host === 'mailpit.test:8025') {
      mails.push(req)
      return Response.json({ ID: 'm' })
    }
    return new Response('{}')
  }
  const env: Record<string, string> = {
    APP_URL: 'http://localhost:5173',
    STRIPE_API_BASE_URL: STRIPE_TEST_ORIGIN,
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: fetchAll,
    now: fixedClock(NOW).now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  return { stripe, service, user, deps, mails }
}
