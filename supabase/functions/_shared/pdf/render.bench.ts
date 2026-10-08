/**
 * Warm render times of the reference documents. The renderer must stay within
 * the Task 3.29 numbers + 20 % (ADR 0008: contract median 134 ms, fiche
 * 81 ms on the dev Mac). Run in review, not in CI:
 * deno bench --config supabase/functions/deno.json --allow-read supabase/functions/_shared/pdf/render.bench.ts
 */
import { referenceContract } from './fixtures/reference-contract.ts'
import { referenceFiche } from './fixtures/reference-fiche.ts'
import { renderPdf } from './render.ts'

const fixture = (name: string) =>
  Deno.readFile(new URL(`./fixtures/${name}`, import.meta.url))
const [logo, photo] = await Promise.all([
  fixture('logo.png'),
  fixture('photo.jpg'),
])

Deno.bench('contract, 6 pages', async () => {
  await renderPdf(referenceContract, {})
})

Deno.bench('fiche, 2 pages, PNG logo + JPEG photo', async () => {
  await renderPdf(referenceFiche, { logo, photo })
})
