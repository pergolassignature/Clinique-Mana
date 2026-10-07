#!/usr/bin/env node
// Reject newly-added supabase/migrations/*.sql files whose HHMMSS portion
// ends in "00" (seconds = 00). Hand-typed timestamps land on round seconds;
// `date -u +%Y%m%d%H%M%S` virtually never does. When two branches both pick
// the same hand-typed value (e.g. 230000), Supabase applies the first one
// merged and silently SKIPS the second.
// See docs/plans/2026-10-06-foundation-rebuild-design.md §6.4.
//
// Compare base defaults to origin/main; override with BASE_REF env var.

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const baseRef = process.env.BASE_REF || "origin/main";
const MIGRATION_RE =
  /^supabase\/migrations\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/;
const legacyRoundTimestampAllowlist = new Set([]);

function listAddedMigrations() {
  try {
    const out = execSync(
      `git diff --name-only --no-renames --diff-filter=A ${baseRef}...HEAD -- "supabase/migrations/*.sql"`,
      { encoding: "utf8" },
    );
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    console.error(
      `[migration-check] Could not diff against ${baseRef}: ${err.message}`,
    );
    console.error(
      `[migration-check] Skipping the round-timestamp check. Set BASE_REF or fetch the base branch first.`,
    );
    return null;
  }
}

// null when the base ref can't be diffed: Check 1 is skipped, Check 2 still runs.
const added = listAddedMigrations();

// Check 1 (round timestamps) only applies to newly-added files; Check 2 below
// (stray/duplicate files) always runs so a bad merge can't slip a dup through.
const offenders = [];
for (const file of added ?? []) {
  if (legacyRoundTimestampAllowlist.has(file)) continue;

  const m = file.match(MIGRATION_RE);
  if (!m) continue;
  const [, Y, M, D, hh, mm, ss] = m;
  if (ss === "00") {
    offenders.push({ file, ts: `${Y}-${M}-${D} ${hh}:${mm}:${ss} UTC` });
  }
}

if (offenders.length > 0) {
  console.error("");
  console.error(
    "[migration-check] FAIL — round (SS=00) migration timestamps detected:",
  );
  console.error("");
  for (const { file, ts } of offenders) {
    console.error(`    ${file}`);
    console.error(`        (${ts})`);
  }
  console.error("");
  console.error(
    "Round timestamps collide silently when two branches pick the same hand-typed",
  );
  console.error(
    "value. Supabase applies the first one merged and skips the rest — the loser",
  );
  console.error("ends up in the repo but never applied to the DB.");
  console.error("");
  console.error("Regenerate the timestamp:");
  console.error("    bash / Linux / macOS:  date -u +%Y%m%d%H%M%S");
  console.error(
    '    PowerShell:            (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")',
  );
  console.error("");
  console.error("Then `git mv` the file to use the new timestamp.");
  console.error("");
  process.exit(1);
}

// --- Check 2: stray / duplicate files in the migrations directory ------------
// Catches (a) Finder/iCloud copies ("..._name 2.sql", "..._name (1).sql",
// "...name copy.sql") and (b) two migrations sharing one timestamp prefix.
// Either makes Supabase apply one file and silently skip the rest, and the
// copies break `supabase db reset` / branch replays. Legit migration filenames
// never contain spaces, so any space in the name is a stray copy.
let dirFiles = [];
try {
  dirFiles = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
} catch {
  dirFiles = [];
}

const spaceNamed = dirFiles.filter((f) => /\s/.test(f));

const byTimestamp = {};
for (const f of dirFiles) {
  const m = f.match(/^(\d{14})_/);
  if (m) (byTimestamp[m[1]] ||= []).push(f);
}
const dupTimestamps = Object.entries(byTimestamp).filter(([, fs]) => fs.length > 1);

if (spaceNamed.length > 0 || dupTimestamps.length > 0) {
  console.error("");
  console.error("[migration-check] FAIL — stray or duplicate migration files:");
  console.error("");
  for (const f of spaceNamed) {
    console.error(`    stray copy (filename has a space): supabase/migrations/${f}`);
  }
  for (const [ts, fs] of dupTimestamps) {
    console.error(`    duplicate timestamp ${ts}: ${fs.join(", ")}`);
  }
  console.error("");
  console.error(
    "Two files with the same timestamp → Supabase applies the first merged and",
  );
  console.error(
    'silently skips the rest. Finder copies (" 2.sql", " (1).sql", " copy.sql")',
  );
  console.error("also break `supabase db reset` and fresh-DB / branch replays.");
  console.error("");
  console.error("Delete the stray copy, or give it a unique real-seconds timestamp.");
  console.error("");
  process.exit(1);
}

if (added === null) {
  console.log(
    "[migration-check] OK — no duplicates or stray copies (round-timestamp check skipped: base ref unavailable).",
  );
} else {
  console.log(
    `[migration-check] OK — ${added.length} new migration(s); no round timestamps, duplicates, or stray copies.`,
  );
}
