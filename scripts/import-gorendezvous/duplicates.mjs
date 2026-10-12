// Duplicate detection for the clients import (plan §6.1 « Keep — moved to SQL », §9 step 3): the
// legacy algorithm (inventory §B, `use-duplicate-detection.ts`) ported and fixed, so the dry run
// reports what `find_client_duplicates` (C2.1) will say. Pure: records in, pairs out.
//
// Fixed from the legacy (decision I-5):
// - a name alone never makes a duplicate (legacy: « same first + last » was MEDIUM);
// - name + birth date without a shared contact is MEDIUM, not HIGH (two people share both);
// - a shared email or phone with a different name is MEDIUM « shared contact », not HIGH: a parent's
//   email and phone are often on a teen's file (Christine, answer 3), and those are two clients;
// - HIGH needs a shared contact (exact email, or the same last 10 phone digits on any of the
//   person's phones) AND the same or a similar name AND no conflicting birth date;
// - accents, case, hyphens and apostrophes are folded before names are compared (legacy compared
//   « Hélène » and « Helene » as different);
// - an email or a phone shared by more than CROWDED_LIMIT records (a placeholder, the clinic's own
//   number) is reported as « crowded » and not used to pair them (legacy would pair them all).
import { foldText, phoneKey } from './normalize.mjs'

/** Above this many records on one contact, the contact is a placeholder, not a person's. */
export const CROWDED_LIMIT = 6
/** Both names at least this similar: « similar name ». */
export const SIMILAR = 0.8
/** An email's local part this long or longer may pair two records on different domains. */
const MIN_LOCAL_PART = 6

/** A name's comparison form: folded, hyphens and apostrophes as spaces, single spaces. */
export const nameForm = (value) =>
  foldText(value)
    .replace(/[-'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The legacy similarity: equal → 1; one inside the other → max(0.7, short / long); else common prefix / long. */
export function similarity(a, b) {
  if (a === '' || b === '') return 0
  if (a === b) return 1
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.includes(short)) return Math.max(0.7, short.length / long.length)
  let prefix = 0
  while (prefix < short.length && short[prefix] === long[prefix]) prefix++
  return prefix / long.length
}

/**
 * A record as the rules read it, from a client record (`readClients`) or an app client:
 * `{ ref, line?, source, first_name, last_name, email, mobile_e164, home_e164, work_e164, birthday }`.
 */
function prepare(record) {
  const phones = [...new Set([record.mobile_e164, record.home_e164, record.work_e164].map(phoneKey).filter(Boolean))]
  const email = record.email || null
  const local = email ? email.split('@')[0] : null
  return {
    record,
    first: nameForm(record.first_name),
    last: nameForm(record.last_name),
    email,
    local: local && local.length >= MIN_LOCAL_PART ? local : null,
    phones,
    phones7: [...new Set(phones.map((p) => p.slice(-7)))],
    birthday: record.birthday || null,
  }
}

/** The pair's level and reasons, or null. */
function judge(a, b) {
  const sameEmail = a.email !== null && a.email === b.email
  const samePhone = a.phones.some((p) => b.phones.includes(p))
  const contact = sameEmail || samePhone
  const sameName = a.first !== '' && a.first === b.first && a.last !== '' && a.last === b.last
  const similarName = !sameName && similarity(a.first, b.first) > SIMILAR && similarity(a.last, b.last) > SIMILAR
  const birthdayConflict = a.birthday !== null && b.birthday !== null && a.birthday !== b.birthday
  const sameBirthday = a.birthday !== null && a.birthday === b.birthday
  const reasons = []
  if (sameEmail) reasons.push('email')
  if (samePhone) reasons.push('phone')
  if (sameName) reasons.push('same_name')
  if (similarName) reasons.push('similar_name')
  if (sameBirthday) reasons.push('birthday')
  if (birthdayConflict) reasons.push('birthday_differs')

  if (contact && (sameName || similarName) && !birthdayConflict) return { level: 'high', reasons }
  if (contact && (sameName || similarName)) return { level: 'medium', reasons }
  if (contact) return { level: 'medium', reasons: [...reasons, 'shared_contact'] }
  if (sameName && sameBirthday) return { level: 'medium', reasons }
  const partialEmail = a.local !== null && a.local === b.local
  const partialPhone = a.phones7.some((p) => b.phones7.includes(p))
  if ((sameName || similarName) && (partialEmail || partialPhone) && !birthdayConflict) {
    return { level: 'medium', reasons: [...reasons, partialEmail ? 'partial_email' : 'partial_phone'] }
  }
  return null
}

/**
 * Finds the duplicates among `incoming` (the export's records) and between them and `existing`
 * (clients already in the app, e.g. created from Demandes; never compared with each other).
 * Candidates come from shared keys only (email, phone, last 7 phone digits, email local part,
 * name + birth date): no all-pairs comparison over thousands of rows.
 *
 * Returns `{ pairs, groups, crowded }`:
 * - `pairs`: `{ a, b, level: 'high' | 'medium', reasons }` with each side's record, HIGH first;
 * - `groups`: the HIGH pairs joined into groups of records that are one person;
 * - `crowded`: `{ kind: 'email' | 'phone', size }` for the contacts too shared to pair on.
 */
export function findDuplicates(incoming, existing = []) {
  const people = [
    ...incoming.map((r) => prepare({ ...r, source: r.source ?? 'import' })),
    ...existing.map((r) => prepare({ ...r, source: 'app' })),
  ]
  const blocks = new Map()
  const add = (key, index) => {
    if (!blocks.has(key)) blocks.set(key, [])
    blocks.get(key).push(index)
  }
  people.forEach((p, i) => {
    if (p.email) add(`e:${p.email}`, i)
    if (p.local) add(`l:${p.local}`, i)
    for (const phone of p.phones) add(`p:${phone}`, i)
    for (const phone of p.phones7) add(`7:${phone}`, i)
    if (p.first && p.last && p.birthday) add(`n:${p.first}|${p.last}|${p.birthday}`, i)
  })

  const crowded = []
  const crowdedEmails = new Set()
  const crowdedPhones = new Set()
  for (const [key, members] of blocks) {
    if (members.length <= CROWDED_LIMIT) continue
    if (key.startsWith('e:')) {
      crowded.push({ kind: 'email', size: members.length })
      crowdedEmails.add(key.slice(2))
    } else if (key.startsWith('p:')) {
      crowded.push({ kind: 'phone', size: members.length })
      crowdedPhones.add(key.slice(2))
    }
  }

  const seen = new Set()
  const pairs = []
  for (const members of blocks.values()) {
    if (members.length < 2 || members.length > CROWDED_LIMIT) continue
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const [i, j] = [members[x], members[y]]
        const id = i < j ? `${i}:${j}` : `${j}:${i}`
        if (seen.has(id)) continue
        seen.add(id)
        if (people[i].record.source === 'app' && people[j].record.source === 'app') continue
        // A placeholder contact never pairs two records, even through another key.
        const a = withoutCrowded(people[i], crowdedEmails, crowdedPhones)
        const b = withoutCrowded(people[j], crowdedEmails, crowdedPhones)
        const verdict = judge(a, b)
        if (verdict) pairs.push({ a: people[i].record, b: people[j].record, ...verdict })
      }
    }
  }
  pairs.sort((p, q) => (p.level === q.level ? 0 : p.level === 'high' ? -1 : 1))
  return { pairs, groups: highGroups(pairs), crowded }
}

function withoutCrowded(person, emails, phones) {
  return {
    ...person,
    email: person.email && emails.has(person.email) ? null : person.email,
    phones: person.phones.filter((p) => !phones.has(p)),
    phones7: person.phones.filter((p) => !phones.has(p)).map((p) => p.slice(-7)),
  }
}

/** The HIGH pairs as groups (union–find): each group is one person in several records. */
function highGroups(pairs) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  for (const { a, b, level } of pairs) {
    if (level !== 'high') continue
    for (const r of [a, b]) if (!parent.has(r)) parent.set(r, r)
    parent.set(find(a), find(b))
  }
  const groups = new Map()
  for (const r of parent.keys()) {
    const root = find(r)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(r)
  }
  return [...groups.values()]
}
