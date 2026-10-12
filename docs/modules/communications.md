# Module `communications` (« Communications »)

The clinic's conversations with its clients: the Gmail mailboxes `info@cliniquemana.com` (the clinic's inbox) and `administration@cliniquemana.com` (payments: the Interac notices, read by Facturation later), mirrored in the app and read in « Courriels » (CM1, CM2), the composer and the Gmail send (CM3), « Rédiger avec l'IA » (CM4), and the SMS (batch SM, lane C). Resend keeps the transactional email (invitations, reminders, notices). Plan: [coding plan §11](../plans/2026-10-11-modules-coding-plan.md#11-communications-communications--batches); roadmap [§2.4](../plans/2026-10-11-next-modules-roadmap.md) and §2.4 bis (what PS Hub brings and the flaws fixed); decisions CM-1… in the [decisions log](../plans/2026-10-07-decisions-log.md).

- **Registry:** `modules.key = 'communications'` (migration `20261012184051_communications_module`), no dependency besides core (Clients is optional: the thread → client link waits for it). It **starts disabled** in every clinic; an admin enables it in Paramètres → Modules.
- **Permissions:** `communications.inbox` (read the shared mailboxes: admin, counselor, admin_assistant), `communications.mailboxes_manage` (connect, disconnect, synchronise, the « Courriels Gmail » settings: admin). Later: `communications.send` (CM3), `communications.ai_draft` (CM4), `communications.sms` / `communications.sms_manage` (SM).
- **Frontend:** `src/modules/communications/` (manifest, `index.ts`, `lib/audit-labels.ts`); i18n `modules.communications.*`.
- **Tests:** pgTAP `096_communications_module`; Vitest next to each file.

## Batches

| Batch | What | Status |
|---|---|---|
| Skeleton | module row, the two first permissions, manifest | built |
| CM1 | `mail_connections` (encrypted tokens), `gmail-connect` / `gmail-callback` (signed state), `gmail-webhook`, `gmail-sync`, the jobs, the mirror tables, the « Courriels Gmail » settings | in progress |
| CM2 | « Courriels »: three panes, read / archive / labels, attachments, search, the thread → client link | planned |
| CM3 | composer, `gmail-send`, templates | planned |
| CM4 | « Rédiger avec l'IA » | planned |
| SM | SMS (Twilio), lane C | planned |
