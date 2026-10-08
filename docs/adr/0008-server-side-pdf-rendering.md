# 0008 — Server-side PDF rendering with pdfmake

**Status:** Accepted (built: Phase 3, Task 3.30 and its review) · **Date:** 2026-10-07 · **Finalised:** 2026-10-08 (Task 3.35) · **Design:** [§6.1](../plans/2026-10-08-phase-3-shared-services-design.md#61-documenso-integration) · **Plan:** [P3-1, P3-19, Tasks 3.29–3.30](../plans/2026-10-08-phase-3-shared-services-plan.md) · **Code:** `supabase/functions/_shared/pdf/`, `scripts/build-pdfmake.ts`, `scripts/build-pdf-fonts.ts`, CLAUDE.md §7

## Context
Contracts (sent to Documenso) and the Phase 4c fiche must be rendered on the server from a structured document model. Signing fields go at fixed coordinates (design §6.1). P3-1 picks pdfmake inside an edge function. Gotenberg (HTML → PDF on the Documenso host) is the fallback behind the same `PdfRenderer` interface, if a decision rule written before measuring fails.

**Supabase limits, re-checked on 2026-10-07** ([Limits](https://supabase.com/docs/guides/functions/limits)):
- 2 s CPU per request; 256 MB memory; 150 s (Free) or 400 s (paid) wall clock.
- Function size: 20 MB when the CLI bundles it, 5 MB when bundled server-side (`--use-api`, Dashboard).
- CLI 2.98.2 (CI's pinned version) sends the eszip brotli-compressed (`EZBR`) and prints that size as « script size ». That is the size the 20 MB limit applies to.

**Decision rule** (from the plan). Adopt pdfmake only if all four hold:
- (a) every glyph renders;
- (b) the contract's warm median is ≤ 300 ms and its cold render ≤ 800 ms (≥ 2.5× headroom on the 2 s CPU limit);
- (c) the bundle is ≤ 10 MB;
- (d) field positions are deterministic.

**Spike measurements** (Task 3.29, 2026-10-07, MacBook Apple M5; pdfmake 0.3.11 from npm, pdfkit 0.19.1, fontkit 2.0.4, Inter 5.3.0 latin only):

| # | Measurement | Contract (6 pages) | Fiche (2 pages, PNG + JPEG) |
|---|---|---|---|
| 1 | Warm, Deno 2.7.14 (`render.bench.ts`, plus a 100-run loop) | median **134 ms**, p95 142 ms | median 81 ms, p95 87 ms |
| 1b | Warm, edge runtime 1.73.13 (`functions serve`, 2nd request onwards) | 168–190 ms | — |
| 2 | Cold, `functions serve`, first request after each restart | render **230 / 246 / 213 ms**; request 918 ms (empty module cache), 387 ms, 349 ms | — |
| 2b | Cold, the CLI's eszip booted in a fresh worker (standalone edge runtime 1.73.13) | module load 51–67 ms; render 211–213 ms; request 270–296 ms | — |
| 3 | Bundle of a function that renders (pdfmake as an `npm:` import) | eszip 44.1 MB raw, **7.57 MB uploaded** (EZBR) | same graph |
| 4 | Glyphs (`pdftotext`, `pdffonts`, fontkit) | é è à ç ô « » ’ œ É À — and NBSP all render; no U+FFFD; only Inter is embedded. Inter lacks U+202F (narrow NBSP) | same |
| 5 | Determinism | Two renders are byte-identical (fixed `CreationDate`): 6 pages, the same 16 fields, and each field matches a drawn box exactly | — |

**Final numbers, as built** (Task 3.30 `a03143c`, review `02fbb40`; same machine, Deno 2.7.14, edge runtime 1.73.13):

| Measurement | Result |
|---|---|
| Warm (`render.bench.ts`) | contract **153 ms**, fiche 89 ms at the review; re-run 2026-10-08: 158 ms / 88 ms. The bench's bound is the spike + 20 %: 161 / 97 ms |
| Live (`functions serve`) | 6 pages, 16 fields; first request 231 ms, then 189 / 197 ms |
| Uploaded size (CLI bundling + EZBR brotli, calibrated on the spike's 7.57 MB) | a function that does not render: **1.35 MB** (0.94 MB without zod); a function that renders: **2.18 MB** (1.86 MB before the latin-ext and vietnamese fonts) |
| Vendored module | `vendor/pdfmake.js` 1.18 MB; `fonts.ts` 346 KB |

## Decision
**Adopt pdfmake 0.3.11.** Every criterion passed in the spike, and still holds as built: (a) the one missing glyph, U+202F, is mapped to U+00A0 (fr-CA `Intl` produces U+00A0 anyway); (b) warm 153 ms, worst cold render 246 ms; (c) 2.18 MB uploaded; (d) deterministic.
- **Vendored, not an npm import.** pdfmake is **not** in `supabase/functions/deno.json` or `deno.lock`. The spike showed that the edge-runtime bundler embeds every npm package of the shared lock in **every** function, so a function that only used supabase-js went from 0.93 to 7.37 MB uploaded. Instead:
  - `npm run build:pdfmake` (`scripts/build-pdfmake.ts`) pre-bundles pdfmake's Node build into one minified ES module, `_shared/pdf/vendor/pdfmake.js`, with `deno bundle --minify`. The npm resolution is pinned by `scripts/build-pdfmake.lock` (`--frozen`), and the output is byte-identical to the npm build.
  - The file starts with a prelude: a closed `require` for five `node:` built-ins, and the license notices of every bundled package. `vendor/pdfmake.js.sha256` pins its content, and `vendor/pdfmake.d.ts` types the part we use. Nobody edits the file by hand.
- **Isolation, guarded by `_shared/pdf/isolation.test.ts`:**
  - `deno.json` and `deno.lock` never name pdfmake, pdfkit or fontkit;
  - only `render.ts` (and tests) import the vendored module;
  - `model.ts`, `template.ts` and `assets.ts` never reach it, so a non-rendering function (e.g. the signing webhook) does not carry it;
  - the file matches its SHA-256, and the pdfmake, pdfkit, fontkit, brotli, dfa and Inter (OFL 1.1, `OFL-Inter.txt`) notices ship with the code.
- **Fonts:** Inter 400 / 600 / 700 in the latin, latin-ext and vietnamese subsets, embedded as base64 **WOFF** in `fonts.ts`. They are generated by `npm run build:pdf-fonts` from the `@fontsource/inter` devDependency. WOFF2 is not used, because fontkit 2.0.4 crashes when subsetting WOFF2 composite glyphs (é, à…). pdfmake has no font fallback, so text is NFC-normalised and split into runs per subset. « Nguyễn Ștefan Łukasz Ğül Dvořák » renders with no `.notdef`.
- **Interface and model:** `PdfRenderer.render(doc, assets) → { bytes, pageCount, fields }`; `renderPdf` (`render.ts`) is its only implementation. Documents use a **closed block model** (`model.ts`, Zod: headings, paragraphs, lists, tables, images, header, footer, one signature page). Templates are stored in that shape and never as HTML. `checkDocument` validates every body before rendering and applies caps: 200 rows per table, 400 table rows and 200 000 characters per document (`document_too_large`).
- **Fixed signing fields:**
  - every page header has an initials box for each `initialsFor` role;
  - the signature page is the last block and therefore the last page, with a signature box and a date box at fixed positions for each signer;
  - the fields are returned with the PDF, and no text anchor is ever searched for.
- **Hardening:**
  - assets are PNG or JPEG only, at most 4000 px a side (read from the header before decoding), and passed as data URLs;
  - pdfmake's URL and local-file access are both denied;
  - fonts are registered once per isolate;
  - no page is ever blank, and headings stay with the next block.

## Consequences
- Functions that do not render stay small. A rendering function carries about +0.8 MB uploaded. Deploys must keep Docker bundling (the CLI default), because `--use-api` caps the size at 5 MB.
- Upgrading pdfmake means rebuilding the vendor file (`build:pdfmake`, with a new lock), re-running `render.bench.ts` and the render tests, and committing the new `.sha256`. Upgrading Inter means running `build:pdf-fonts` again.
- Isolates retire after about 1 s of CPU (a fresh worker every ~6 contracts locally), so the cold path (about 300 ms per request) is the normal case, and it is within budget.
- **Fallback: Gotenberg**, behind `PdfRenderer` (HTML rendered from the same block model, fixed CSS boxes, Letter `@page`). It is triggered if Christine needs Word-level fidelity, or if a real template breaks the CPU budget (a warm contract median above 300 ms, or a 2 s CPU kill on staging). It needs a host on the Documenso server and `GOTENBERG_URL` (Mise en service 5). Its image was never pulled.

## Alternatives
- **pdfmake as an `npm:` import in `deno.json`:** this was the spike's setup. It adds about 6.4 MB uploaded to every function.
- **A per-function `deno.json`:** the shared check and test configuration and the lock would still resolve pdfmake, and CI copies the shared lock into every function folder.
- **Gotenberg now:** it needs a server, a network hop and a shared secret, and the numbers do not call for it.
- **pdf-lib alone:** it has no layout engine; it remains a candidate for post-processing only.
- **`@react-pdf` in the browser** (PS Hub): rejected by design §6.1, because the PDF must come from the server.
