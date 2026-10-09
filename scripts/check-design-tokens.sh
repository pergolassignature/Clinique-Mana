#!/usr/bin/env bash
# Guardrail on Tailwind class names, two families (docs/design-system/typography-and-spacing.md):
#
# 1. Names that read like design-system tokens but draw the wrong colour. The design system calls
#    #8E8E92 `--text-muted` and #F4F4F5 `--bg-secondary`, but in Tailwind `muted` is the #F4F4F5
#    fill (`bg-muted`):
#    - `text-muted` exists and renders #F4F4F5 on white: invisible text. So does `text-muted-strong`
#      (#E9E9EB). Informative text is `text-muted-foreground` (#6B6B6E, decision #30); decoration
#      (placeholders, disabled text, separators, icons) is `text-subtle` (#8E8E92). Same for
#      `fill-`/`stroke-muted`.
#    - `*-secondary` is not a token here: text is `text-muted-foreground`, fills `bg-muted`,
#      borders `border-border`.
#    `bg-muted`, `bg-muted-strong` and `text-muted-foreground` are correct. CSS variables
#    (`--text-muted`) are not matched.
# 2. Type off the scale: an arbitrary font size (`text-[13px]`, `text-[0.8rem]`), an arbitrary line
#    height (`leading-[22px]`), or a weight the scale does not use (`font-bold`, `font-light`…).
#    Sizes come with their line height (`text-sm` is 13/18); weights are 400 / 500 / 600. Colours in
#    brackets (`text-[rgb(…)]`, `text-[#fff]`) are not sizes and pass. A deliberate exception
#    carries `design-tokens: allow` on the same line, with the reason (e.g. avatar initials).
#
# The guard's own test (src/test/design-tokens-guard.test.ts) holds the failing fixtures and is
# skipped by path. Usage: check-design-tokens.sh [dir] (default: src).
set -euo pipefail

DIR="${1:-src}"
[ -d "$DIR" ] || { echo "$DIR not found" >&2; exit 2; }

# One perl process for every file (one per file was slow enough to time out under a full test run).
# perl exits non-zero only on a real error (unreadable file…), which then fails the script.
hits=$(find "$DIR" -type f \( -name '*.tsx' -o -name '*.ts' \) ! -path '*src/test/design-tokens-guard.test.ts' -print0 |
  xargs -0 perl -ne '
    BEGIN {
      # Not preceded by a word character or "-" (so `--text-muted` is ignored); any suffix except
      # `-foreground` is flagged (`text-muted`, `text-muted/60`, `text-muted-strong`).
      $muted = qr/(?<![\w-])(?:text|fill|stroke)-muted(?!-foreground(?![\w-]))(?!\w)/;
      $secondary = qr/(?<![\w-])(?:text|bg|border)-secondary(?![\w-])/;
      $size = qr/(?<![\w-])text-\[(?:length:)?-?[\d.]+(?:px|rem|em|pt|vw|vh|%)\]/;
      $leading = qr/(?<![\w-])leading-\[[^\]]+\]/;
      $weight = qr/(?<![\w-])font-(?:thin|extralight|light|bold|extrabold|black)(?![\w-])/;
    }
    next if /design-tokens: allow/;
    while (/$muted|$secondary/g) { print "token  $ARGV:$.: $&\n" }
    while (/$size|$leading|$weight/g) { print "scale  $ARGV:$.: $&\n" }
  } continue { close ARGV if eof
  ')

if [ -n "$hits" ]; then
  tokens=$(printf '%s\n' "$hits" | sed -n 's/^token //p')
  scale=$(printf '%s\n' "$hits" | sed -n 's/^scale //p')
  if [ -n "$tokens" ]; then
    echo "ERROR: these classes are not design-system tokens in Tailwind:"
    printf '%s\n' "$tokens"
    echo "Use instead:"
    echo "  text-muted(-strong) -> text-muted-foreground (informative text) or text-subtle (placeholders, disabled, icons)"
    echo "  fill/stroke-muted -> fill-subtle / stroke-subtle"
    echo "  text-secondary  -> text-muted-foreground"
    echo "  bg-secondary    -> bg-muted"
    echo "  border-secondary -> border-border"
  fi
  if [ -n "$scale" ]; then
    echo "ERROR: type off the design-system scale:"
    printf '%s\n' "$scale"
    echo "Use a scale size, which carries its line height: text-2xs 11/16, text-xs 12/16, text-sm 13/18,"
    echo "text-base 14/20, text-lg 16/24, text-xl 20/28, text-2xl 24/32; weights font-normal, font-medium,"
    echo "font-semibold. A deliberate exception: \`design-tokens: allow\` and the reason on the same line."
  fi
  echo "See docs/design-system/typography-and-spacing.md."
  exit 1
fi
echo "OK: design-token class names and type scale."
