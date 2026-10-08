# Runbook — Back up and drop the legacy `professional-documents` bucket

**Status:** Pending Jonathan's go-ahead. Not executed. · **Written:** 2026-10-08 (Phase 3, Task 3.28) · **Design:** [§7, « Legacy bucket »](../plans/2026-10-08-phase-3-shared-services-design.md#7-storage-corestorage), [§12 item 7](../plans/2026-10-08-phase-3-shared-services-design.md#12-what-jonathan-must-provide-or-approve) · **Plan:** [Mise en service item 14](../plans/2026-10-08-phase-3-shared-services-plan.md#mise-en-service-jonathan) · **Snapshot:** [staging, 2026-10-07](../audit/2026-10-07-staging-snapshot.md)

> **This is a staging mutation and a Drop.** Run it only after Jonathan gives an explicit OK in chat for this runbook (CLAUDE.md §11). **An agent never runs it**, not even partly: no listing, no download and no deletion against staging. Jonathan runs every step himself, in his own terminal.

## What and why
- Staging project `vnmbjbdsjxmpijyjmmkh` still has the legacy bucket `professional-documents`. It is private, has a 10 MB limit, and accepts pdf, jpeg, png, webp, doc and docx. On 2026-10-07 it held **39 test objects**.
- The foundation reset kept the bucket. It has no storage policy left, so no client can read it. The 2026-10-07 database backups do not include its files.
- The Phase 3 buckets (`org-assets`, `documents`, `signed-documents`) replace it. No code refers to `professional-documents` (`grep -rn professional-documents src supabase` finds nothing). No inventory feature is dropped.
- Its files may hold names or other personal data (legacy professional documents), even though they are test files. **Never commit a listing, a file name or a file**, and never paste them in chat.

## Before you start
- Supabase CLI 2.98.2 or later, logged in (`supabase login`), in a checkout linked to staging: `supabase link --project-ref vnmbjbdsjxmpijyjmmkh`. The `supabase storage` commands use the linked project's credentials, so no key is pasted for steps 1 to 4.
- Free disk space: the bucket holds at most 39 × 10 MB.
- The backup folder lives **outside git**, next to the earlier staging backups:
  ```bash
  B="/Users/jonathanharvey/Documents/Claude Projects/clinique-mana-backups/$(date +%F)-professional-documents"
  mkdir -p "$B"
  ```

## Steps
1. **Inventory (read only).** In the dashboard SQL editor, run this query and save the result as `$B/inventory.csv` (outside git):
   ```sql
   select name, (metadata->>'size')::bigint as bytes, created_at
     from storage.objects
    where bucket_id = 'professional-documents'
    order by name;
   ```
   Note the row count and the sum of `bytes`. Expected: 39 rows. If the count is different, stop and tell the agent the count only.
   Optional cross-check: `supabase --experimental storage ls -r ss:///professional-documents/ --linked > "$B/listing.txt"`.
2. **Download** every object into the backup folder:
   ```bash
   supabase --experimental storage cp -r ss:///professional-documents "$B/files" --linked
   ```
3. **Check the backup.** The file count and the total size must equal step 1:
   ```bash
   find "$B/files" -type f | wc -l
   find "$B/files" -type f -exec stat -f %z {} + | awk '{s+=$1} END {print s}'
   ```
   Open two or three files to check they are readable. **Stop here if anything differs.** Nothing has been deleted yet.
4. **Delete the objects** through the Storage API:
   ```bash
   supabase --experimental storage rm -r ss:///professional-documents/ --linked
   ```
   Then run step 1's query again. Expected: 0 rows. Never delete with SQL (`delete from storage.objects`): Supabase refuses direct deletes on storage tables, and the files would stay in the object store anyway. The CLI empties the bucket just as the Storage API's `emptyBucket` would.
5. **Delete the bucket** (the CLI has no bucket command). This is the only step that needs a key: the staging `service_role` key from Dashboard → Settings → API keys. Read it into a variable without echoing it. It must never be pasted in chat, written to a file or committed:
   ```bash
   read -rs KEY
   curl -sS -X DELETE "https://vnmbjbdsjxmpijyjmmkh.supabase.co/storage/v1/bucket/professional-documents" \
     -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
   unset KEY
   ```
   Expected: `{"message":"Successfully deleted"}`. A « not empty » error means step 4 is incomplete: repeat it. To check, `select id from storage.buckets` no longer lists the bucket.
6. **Record it.** Tell the agent « bucket dropped on <date>, 39 objects backed up » (no file names). The agent then updates the Storage row of [the staging snapshot](../audit/2026-10-07-staging-snapshot.md) and Mise en service item 14 with the date and the backup folder's name.

## Rollback
- Steps 1 to 3 change nothing on staging.
- After step 4 or 5, re-create the bucket in the dashboard with the same settings (private, 10 MB, the six MIME types above). Then upload the backup with `supabase --experimental storage cp -r "$B/files" ss:///professional-documents --linked`.
- The backup folder is the only copy: keep it until Jonathan decides otherwise.
