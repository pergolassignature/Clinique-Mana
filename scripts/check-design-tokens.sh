#!/usr/bin/env bash
# Guardrail: Tailwind class names that look like design-system tokens but are not the right ones.
# The design system calls #8E8E92 `--text-muted` and #F4F4F5 `--bg-secondary`, but in Tailwind:
#   - `text-muted` does not exist (Tailwind would emit nothing). Informative text is
#     `text-muted-foreground` (#6B6B6E, decision #30); decoration (placeholders, disabled text,
#     separators, icons) is `text-subtle` (#8E8E92).
#   - `*-secondary` does not exist either: text is `text-muted-foreground`, fills `bg-muted`,
#     borders `border-border`.
# `bg-muted`, `text-muted-foreground`, `bg-muted-strong` are correct. CSS variables (`--text-muted`)
# are not matched. Exemption (this guard's own fixtures): "// DESIGN_TOKENS_ALLOWED: <reason>".
# Usage: check-design-tokens.sh [dir] (default: src). Mapping: docs/standards/brand.tokens.md.
set -euo pipefail

DIR="${1:-src}"
[ -d "$DIR" ] || { echo "$DIR not found" >&2; exit 2; }

# Not preceded by a word character or "-" (so `--text-muted` and `bg-text-muted…` are ignored).
MUTED='(?<![\w-])(?:text|fill|stroke)-muted(?!-foreground|-strong)(?![\w-])'
SECONDARY='(?<![\w-])(?:text|bg|border)-secondary(?![\w-])'

hits=""
while IFS= read -r -d '' file; do
  if grep -qE 'DESIGN_TOKENS_ALLOWED: *[^ ]' "$file"; then continue; fi
  # perl exits non-zero only on a real error (unreadable file…), which then fails the script.
  found=$(perl -ne "print \"  \$ARGV:\$.: \$&\\n\" while /$MUTED|$SECONDARY/g" "$file")
  if [ -n "$found" ]; then hits="${hits}${found}"$'\n'; fi
done < <(find "$DIR" -type f \( -name '*.tsx' -o -name '*.ts' \) -print0)

if [ -n "$hits" ]; then
  echo "ERROR: these classes are not design-system tokens in Tailwind:"
  printf '%s' "$hits"
  echo "Use instead:"
  echo "  text-muted      -> text-muted-foreground (informative text) or text-subtle (placeholders, disabled, icons)"
  echo "  fill/stroke-muted -> fill-subtle / stroke-subtle"
  echo "  text-secondary  -> text-muted-foreground"
  echo "  bg-secondary    -> bg-muted"
  echo "  border-secondary -> border-border"
  echo "See docs/standards/brand.tokens.md."
  exit 1
fi
echo "OK: design-token class names."
