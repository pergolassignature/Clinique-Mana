#!/usr/bin/env bash
# Guardrail: Tailwind class names that read like design-system tokens but draw the wrong colour.
# The design system calls #8E8E92 `--text-muted` and #F4F4F5 `--bg-secondary`, but in Tailwind
# `muted` is the #F4F4F5 fill (`bg-muted`):
#   - `text-muted` exists and renders #F4F4F5 on white: invisible text. So does `text-muted-strong`
#     (#E9E9EB). Informative text is `text-muted-foreground` (#6B6B6E, decision #30); decoration
#     (placeholders, disabled text, separators, icons) is `text-subtle` (#8E8E92). Same for
#     `fill-`/`stroke-muted`.
#   - `*-secondary` is not a token here: text is `text-muted-foreground`, fills `bg-muted`,
#     borders `border-border`.
# `bg-muted`, `bg-muted-strong` and `text-muted-foreground` are correct. CSS variables
# (`--text-muted`) are not matched. The guard's own test (src/test/design-tokens-guard.test.ts)
# holds the failing fixtures and is skipped by path.
# Usage: check-design-tokens.sh [dir] (default: src). Mapping: docs/standards/brand.tokens.md.
set -euo pipefail

DIR="${1:-src}"
[ -d "$DIR" ] || { echo "$DIR not found" >&2; exit 2; }

# Not preceded by a word character or "-" (so `--text-muted` is ignored); any suffix except
# `-foreground` is flagged (`text-muted`, `text-muted/60`, `text-muted-strong`).
MUTED='(?<![\w-])(?:text|fill|stroke)-muted(?!-foreground(?![\w-]))(?!\w)'
SECONDARY='(?<![\w-])(?:text|bg|border)-secondary(?![\w-])'

hits=""
while IFS= read -r -d '' file; do
  case "$file" in */src/test/design-tokens-guard.test.ts | src/test/design-tokens-guard.test.ts) continue ;; esac
  # perl exits non-zero only on a real error (unreadable file…), which then fails the script.
  found=$(perl -ne "print \"  \$ARGV:\$.: \$&\\n\" while /$MUTED|$SECONDARY/g" "$file")
  if [ -n "$found" ]; then hits="${hits}${found}"$'\n'; fi
done < <(find "$DIR" -type f \( -name '*.tsx' -o -name '*.ts' \) -print0)

if [ -n "$hits" ]; then
  echo "ERROR: these classes are not design-system tokens in Tailwind:"
  printf '%s' "$hits"
  echo "Use instead:"
  echo "  text-muted(-strong) -> text-muted-foreground (informative text) or text-subtle (placeholders, disabled, icons)"
  echo "  fill/stroke-muted -> fill-subtle / stroke-subtle"
  echo "  text-secondary  -> text-muted-foreground"
  echo "  bg-secondary    -> bg-muted"
  echo "  border-secondary -> border-border"
  echo "See docs/standards/brand.tokens.md."
  exit 1
fi
echo "OK: design-token class names."
