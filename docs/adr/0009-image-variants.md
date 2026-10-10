# 0009 — Image variants through Supabase image transformations, signed by storage-sign

**Status:** Accepted (coordinator, 2026-10-10, for Jonathan's « tout automatique ») · **Date:** 2026-10-10 · **Decision:** PERF-1 · **Code:** `supabase/functions/storage-sign/handler.ts` (`IMAGE_VARIANTS`), `src/core/storage/` (`ImageVariant`), CLAUDE.md §7–8

## Context
Production's 36 photos are PNG cut-outs from the website, 326 KB to 1.6 MB each (1.06 MB on average, 37 MB in total, measured 2026-10-10). The list shows them at 24 px and the record header at 48 px, yet each page downloaded the originals: 25 rows ≈ 21 MB, and the photos finished about 13 s after the rows on a 4G-class link. Jonathan wants the small copies to be automatic, for existing photos and for every future upload or import, with nothing to run.

## Decision
- `storage-sign` takes `variant: 'avatar' | 'card' | 'print'`, in single and batch modes, never with `download`. It maps each name to a fixed transform (`IMAGE_VARIANTS`: `contain` in a 128, 256 or 600 px square) signed into the token (`/render/image/sign/…`). The client never sends a width. Only `stored_files` rows whose sniffed `mime_type` is PNG, JPEG or WebP take one: another file gets a 400 (single) or is left out (batch). Readability is decided first, as before (P3-33). There is still one read path.
- Storage serves WebP to an `<img>` (transparency kept). The fiche fetches `print` accepting PNG and JPEG only, which react-pdf embeds, and falls back to the original.
- Kill switch: the function secret `STORAGE_IMAGE_VARIANTS=off` signs the originals: the same answers, bigger files.
- Locally, `[storage.image_transformation]` in `config.toml` (imgproxy). CI's e2e job keeps imgproxy.

## Consequences
- Nothing to generate, store, backfill or purge. Every photo is covered: existing ones, staff, self, questionnaire and import. One avatar is about 2 to 10 KB.
- **Cost:** the Pro plan includes 100 origin images a month; we transform 36 to 60. Past that, Supabase bills about 5 USD per 1,000 origin images (as of 2026-10). Watch « Storage Image Transformations » in the usage page if the photo count grows past about 90.
- Every new image display picks a variant, or knowingly the original (`DocumentPreview`: the document itself).
- If transformations fail (quota, outage), the avatars show initials and the fiche prints the original. Set the kill switch until it is fixed.

## Alternatives
- **A resized copy made in the browser before `uploadFile`:** it does not cover the existing photos or the imports, and needs a second file, purpose and lifecycle.
- **A copy made in `storage-confirm` plus a backfill job:** an image codec in Deno ships in every function (ADR 0008's rule) or must be vendored. It also adds a table or column, a job and its retries, and 2 s CPU per request for decoding 4000 px PNGs.
- **A 7-day device cache, as PS Hub has:** refused. Files never persist on shared reception PCs beyond the browser's ordinary HTTP cache.
