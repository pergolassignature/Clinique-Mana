#!/usr/bin/env node
// Information only (exit 0): the strings of src/i18n/fr-CA.json that still hold a plain space
// before « ? ! ; : » or inside « ». `t()` replaces them with U+202F at runtime (`frenchSpacing`,
// src/i18n/index.ts), so nothing is wrong on screen; the list helps clean the file over time.
// Usage: node scripts/report-french-spacing.mjs [--all]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'fr-CA.json')
const dictionary = JSON.parse(fs.readFileSync(file, 'utf8'))
const PLAIN = / [?!;:]|«[^\u202F\u00A0]|[^\u202F\u00A0]»/

const hits = []
const walk = (node, at) => {
  if (typeof node === 'string') {
    if (PLAIN.test(node)) hits.push(at)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) walk(value, at ? `${at}.${key}` : key)
  }
}
walk(dictionary, '')

const shown = process.argv.includes('--all') ? hits : hits.slice(0, 20)
console.log(`fr-CA.json: ${hits.length} strings with a plain space (or none) where French wants U+202F; t() fixes them at runtime.`)
for (const key of shown) console.log(`  ${key}`)
if (shown.length < hits.length) console.log(`  … ${hits.length - shown.length} more (--all)`)
