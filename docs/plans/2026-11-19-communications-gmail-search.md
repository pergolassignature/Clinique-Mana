# « Courriels »: searching beyond the mirror (design)

- **Date:** 2026-11-19
- **Status:** decided and built (CM-30). Pierre-Luc chose B on 2026-11-19, and confirmed the recommended window (24 months) and who may search (whoever reads the mailbox) the same day. If Christine changes the retention (roadmap question 30), the window follows it.
- **Where it comes from:** PS Hub's shared-email plan, stage 3, slice 3c (`new-ps-hub` `docs/plans/2026-10-29-email-ui-shared-with-clinique-mana.md`). It is the one Gmail gap a person feels; 3a (the parser) is done (PR #233), and 3b (inline GIF images) waits until one shows up.

## The problem

« Courriels »' search field finds only what the mirror holds, and only by a few fields:

- **Older mail cannot be found.** The mirror starts 45 days before the mailbox was connected (CM-7). A client who wrote in the spring is not in it.
- **A word in a message's text is not found.** `mail_messages.search_vector` covers the subject, the sender and the snippet (French), not `body_text`.
- **Gmail's operators are read as words.** `from:alice` or `has:attachment` find nothing.

Gmail itself finds all three, in the whole mailbox.

## What already exists

- **The search:** `list_mail_threads(…, p_search, …)`, security invoker over the mirror's RLS, `websearch_to_tsquery('french', …)` on `search_vector`. `InboxPage` sends what is typed 300 ms after the last key; a search shows the « Tous » view.
- **Copying one message now:** `mirrorMessage` (`_shared/gmail/sync.ts`), which `gmail-send` already uses so that a sent message shows in its thread at once. It writes through `upsert_mail_messages`, as the sync does: the client links (CM2b, by trigger on insert), the 24-month purge (CM-8) and the attachment copy (by the next pass) then apply as to any message.
- **The list:** the kit's `MailListView` has a `header` (the search field), a `footer` slot and `isSearch`.
- **PS Hub's way:** its `gmail-search` asks Gmail (`messages.list`, `q`), **copies every hit** into its mirror, and adds the hits' ids to the list's own search (`useGmailSearchHits`). It suits PS Hub, which keeps every email of a deal; MANA decided to hold less (CM-7, CM-8).

## Decision 1 — what a search copies into the clinic's database

| | What it does | For | Against |
|---|---|---|---|
| **A. Copy every hit** (PS Hub) | Gmail's matches (25 at most) are copied into the mirror and appear in the list like any thread | One list, one way to open a thread | Each search copies up to 25 messages of client correspondence the clinic never opened (Loi 25: keep what the clinic needs), and each copy is matched to client files |
| **B. Show Gmail's hits, copy only the one opened** (recommended) | The list shows the mirror's results, then « Dans Gmail » with Gmail's matches that the mirror does not hold: sender, subject, date, snippet, read from Gmail and **never stored**. Opening one copies that thread (`mirrorMessage`, as `gmail-send` does) and opens it as an ordinary thread | Only what a person opens is kept, and then it follows every rule of the mirror | Two groups in the list; a hit is opened in two steps (copy, then read) |
| **C. Copy nothing** | « Chercher dans Gmail » opens Gmail's own search for the mailbox in a new tab | No new function, nothing kept | The person leaves the app, and the thread cannot be linked to a file from there |

**Recommendation: B.** It finds what Gmail finds and keeps only what someone chose to read.

## Decision 2 — how far back

Within the mirror's retention: Gmail is asked for `<what was typed> newer_than:2y`. A message older than 24 months would lose its body to the purge (CM-8) the next night, so copying it would show a body the clinic decided not to keep. Older mail is left to Gmail, through C's link under the results (« Plus ancien que 24 mois : chercher dans Gmail »). If Christine changes the 24 months (roadmap question 30), the window follows the setting.

## Decision 3 — who may search Gmail

Whoever reads the mailbox (`communications.inbox`, `private.readable_mail_connection_ids`), as for the mirror. No new permission.

## Not proposed: indexing the text

`search_vector` could take `body_text`. It is not proposed: with B, Gmail already finds a word in the text, within the same 24 months; and indexing bodies of up to 1 MB each grows the table and its index for every message, opened or not.

## The shape, with B

**One function, `gmail-search`** (user; `communications.inbox`; the module gate; a limit `communications.gmail_search_user`, 30 a minute; nothing logged but ids and codes):

- **`{ action: 'search', connection_id, query }`** (2 to 200 characters):
  1. The caller's right to the mailbox, checked as the caller (the mirror's RLS).
  2. Gmail `messages.list` with `q = query newer_than:2y`, 25 at most, then `messages.get` `format=metadata` (From, Subject, Date) for each.
  3. The threads the mirror already holds are dropped (one RPC as the caller, by `gmail_thread_id`).
  4. It answers `{ threads: [{ gmail_thread_id, subject, from_name, from_address, date, snippet }] }`. Nothing is written.
- **`{ action: 'open', connection_id, gmail_thread_id }`:**
  1. The same right, then Gmail `threads.get` (`format=full`, its messages within the 24 months).
  2. Each message through `mirrorMessage`.
  3. It answers the mirror's `thread_id`, which the reader opens. The attachments are copied by the next sync pass, as for a sent message.

**The list (`InboxPage`):** while a search is shown, the kit's `footer` holds « Dans Gmail »:
- Gmail's hits, drawn as rows: sender, subject, date, snippet;
- « Recherche dans Gmail… » while waiting;
- nothing when Gmail finds nothing new;
- the link for older mail.

Opening a hit says « Ouverture… », then shows the thread. If the footer's rows want the kit's own row drawing, that is a small kit option, decided when built.

**Database:** one service RPC on the inbox's actor model (conventions §8b), `get_mail_search_threads_for_service(p_actor, p_org_id, p_connection_id, p_gmail_thread_ids)`: the caller re-checked (active, `communications.inbox`, the mailbox connected and readable by them), then the ids of the given Gmail threads the mirror holds in that mailbox. Its pgTAP test (260) covers another mailbox's and another clinic's threads, a disabled member, a disconnected and someone else's personal mailbox. No table, no column. (The design first had a security-invoker RPC; the function needs the caller's right checked before it reads the mailbox's token, as `gmail-modify` does.)

**Tests:**
- the function, with a fake Gmail:
  - the right refused;
  - the query window;
  - the mirror's threads dropped;
  - nothing written by a search;
  - an open copying the thread, once, even when asked twice;
- the RPC's pgTAP;
- the list's footer;
- a browser run on the throwaway page.

**Size:** about 300 lines of function and its tests, one small migration, about 150 lines for the footer and its tests.

## Questions for Jonathan

1. A, B or C? (Recommended: B.)
2. 24 months, the mirror's own window? (Christine's question 30 may change it.)
3. Everyone who reads the mailbox, as today?
