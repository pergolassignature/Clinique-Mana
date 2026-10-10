# Architecture Decision Records

One file per decision that is hard to reverse or that later work must respect: `NNNN-short-title.md`, numbered in order, never renumbered. A decision that changes is **superseded** by a new ADR (the old one stays, with its status updated), not edited away.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-foundation-rebuild.md) | Rebuild in place; legacy kept read-only in `_legacy/` | Accepted |
| [0002](0002-permissions-model.md) | Permissions held in the database, read by RLS and the app | Accepted |
| [0003](0003-module-and-settings-registry.md) | Module manifests, `org_modules`, settings registry, import boundaries | Accepted |
| [0004](0004-secrets-in-vault.md) | Secrets in Vault, write-only from the UI; encrypted `*_private` tables | Accepted |
| [0005](0005-documenso-replaces-docuseal.md) | Self-hosted Documenso replaces DocuSeal | Accepted |
| [0006](0006-session-and-recovery-policy.md) | Session and recovery policy (shared reception PCs, enumeration-safe auth) | Accepted |
| [0007](0007-secure-links-and-public-token-functions.md) | Secure links: hashed single-use tokens in the URL fragment, pluggable purposes, public token functions | Accepted |
| [0008](0008-server-side-pdf-rendering.md) | Server-side PDF rendering with a vendored pdfmake, isolated from the other functions | Accepted |
| [0009](0009-image-variants.md) | Image variants (small photos) through Supabase image transformations, signed by `storage-sign` | Accepted |

## Template

```markdown
# NNNN — Title

**Status:** Proposed | Accepted | Superseded by NNNN · **Date:** YYYY-MM-DD · **Design:** §x

## Context
What forces the decision: the problem, constraints, what exists today.

## Decision
What we do, stated so a reviewer can check code against it.

## Consequences
What becomes easier, what becomes harder, what we must now always do.

## Alternatives
Options considered and why they lost.
```

Keep each ADR between 15 and 30 lines; link the design section, review or migration that holds the detail.
