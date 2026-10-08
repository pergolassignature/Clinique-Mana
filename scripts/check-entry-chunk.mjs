#!/usr/bin/env node
// Fails the build when signed-in code has reached the login page's JS (perf R4): the entry chunk
// and every chunk index.html preloads with it. ESLint's entry-path rule (eslint.config.js) stops
// the usual static imports; this checks the built result, whatever the import path.
//
// Markers are strings each library always ships, so they survive minification:
// - date-fns: its default (en-US) and fr locales' « less than a second » texts;
// - cmdk: its DOM attribute names.
// Each marker must still appear in SOME built chunk: if a library update renames one, this script
// fails instead of silently checking nothing.
//
// Usage: node scripts/check-entry-chunk.mjs [distDir]   (run by `npm run build`)

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = process.argv[2] ?? "dist";
const assets = join(dist, "assets");

const MARKERS = {
  "date-fns": ["less than a second", "moins d’une seconde"],
  cmdk: ["cmdk-item", "cmdk-group-heading"],
};

const fail = (message) => {
  console.error(`[entry-chunk] ${message}`);
  process.exit(1);
};

let html;
try {
  html = readFileSync(join(dist, "index.html"), "utf8");
} catch {
  fail(`${join(dist, "index.html")} not found: run vite build first.`);
}

// The module script (entry) and the modulepreload links Vite adds for its static imports.
const urls = [
  ...[...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]),
];
if (!urls.some((url) => url.endsWith(".js"))) fail("no module script in index.html: has the HTML changed?");

// By file name, whatever `base` the URLs carry.
const chunkFiles = readdirSync(assets).filter((name) => name.endsWith(".js"));
const loginFiles = [...new Set(urls.map((url) => basename(url)))];
for (const name of loginFiles) {
  if (!chunkFiles.includes(name)) fail(`index.html references ${name}, which is not in ${assets}.`);
}

const read = (name) => readFileSync(join(assets, name), "utf8");
const staleMarkers = [];
const leaks = [];
for (const [library, markers] of Object.entries(MARKERS)) {
  for (const marker of markers) {
    if (!chunkFiles.some((name) => read(name).includes(marker))) {
      staleMarkers.push(`marker "${marker}" (${library}) is in no chunk at all: update MARKERS in this script.`);
    }
    for (const name of loginFiles) {
      if (read(name).includes(marker)) leaks.push(`${name} contains "${marker}": ${library} is on the login page.`);
    }
  }
}
if (leaks.length > 0) {
  leaks.push("Load signed-in code through lazyPage()/import(), never statically from an entry-path file.");
}
const problems = [...staleMarkers, ...leaks];
if (problems.length > 0) fail(problems.join("\n[entry-chunk] "));

let raw = 0;
let gzip = 0;
for (const name of loginFiles) {
  const content = readFileSync(join(assets, name));
  raw += content.length;
  gzip += gzipSync(content).length;
}
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
console.log(`[entry-chunk] OK: login page JS ${loginFiles.length} files, ${kB(raw)} (gzip ${kB(gzip)}); no date-fns, no cmdk.`);
