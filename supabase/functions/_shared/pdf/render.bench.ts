/**
 * Warm render times of the reference documents (Task 3.29 measurement 1;
 * Task 3.30 keeps its renderer within the ADR 0008 numbers + 20 %). Run in
 * review, not in CI:
 * deno bench --config supabase/functions/deno.json --allow-read supabase/functions/_shared/pdf/render.bench.ts
 */
import { renderWithPdfmake } from './spike/pdfmake-spike.ts'
import { referenceContract } from './spike/reference-contract.ts'
import { referenceFiche } from './spike/reference-fiche.ts'

const fixture = (name: string) =>
  Deno.readFile(new URL(`./spike/fixtures/${name}`, import.meta.url))
const [logo, photo] = await Promise.all([
  fixture('logo.png'),
  fixture('photo.jpg'),
])

Deno.bench('contract, 6 pages', async () => {
  await renderWithPdfmake(referenceContract, {})
})

Deno.bench('fiche, 2 pages, PNG logo + JPEG photo', async () => {
  await renderWithPdfmake(referenceFiche, { logo, photo })
})
