// The reviewed mapping files of the GOrendezvous import (plan §9, I1): GOrendezvous's employee
// profiles → the app's professionals, and the services as GOrendezvous names them → the
// catalogue's codes. Both are small CSV files the clinic reviews line by line (decision I-9); a
// line that cannot be resolved is refused with its line number, never guessed. Pure: the
// professionals and the catalogue come from the caller (read through the published views).
import { readTable } from './table.mjs'
import { foldText, parseYesNo } from './normalize.mjs'

// --- Employees → professionals --------------------------------------------------------------------

/** GOrendezvous's agendas that are not professionals (plan §9): never mapped, whatever the file says. */
export const EXCLUDED_EMPLOYEES = ['conseillère', 'Administration', 'Z MATRICE']

export const EMPLOYEE_COLUMNS = {
  employee: ['Employé', 'Employe', 'Employée', 'Employee', 'Professionnel GOrendezvous', 'Nom GOrendezvous', 'GOrendezvous'],
  professional: ['Professionnel', 'Professionnelle', 'Professionnel MANA', 'Dossier', 'Permis', 'Professional'],
  excluded: ['Exclure', 'Exclu', 'Exclude'],
}

export const MAPPING_REASON_LABELS = {
  missing_employee: 'nom GOrendezvous manquant',
  duplicate_employee: 'nom GOrendezvous déjà vu plus haut',
  missing_professional: 'professionnel manquant (ou « Exclure » à oui)',
  unknown_professional: 'aucun professionnel de l’app ne porte ce nom ou ce permis',
  ambiguous_professional: 'plusieurs professionnels de l’app correspondent : indiquez le numéro de permis',
  invalid_excluded: '« Exclure » : oui ou non',
  missing_service: 'nom du service manquant',
  duplicate_service: 'service déjà vu plus haut',
  invalid_code: 'code à 5 chiffres attendu',
  unknown_code: 'ce code n’est pas au catalogue (Services et tarifs)',
}

/**
 * The professionals of the app as the employees file names them: `directory` rows of
 * `professionals_directory` ({ id, display_name, licence_number, primary_title_id, professions:
 * [{ title_id, licence_number, is_primary }] }). A name matches `display_name` (case and accents
 * aside); a licence number matches any of the professional's licences.
 */
function professionalIndex(directory) {
  const byName = new Map()
  const byLicence = new Map()
  const add = (map, key, pro) => {
    if (!key) return
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(pro)
  }
  for (const pro of directory) {
    add(byName, foldText(pro.display_name), pro)
    for (const licence of [pro.licence_number, ...(pro.professions ?? []).map((p) => p.licence_number)]) {
      add(byLicence, String(licence ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase(), pro)
    }
  }
  return (value) => {
    const licence = String(value).replace(/[^0-9a-z]/gi, '').toUpperCase()
    const matches = byLicence.get(licence) ?? byName.get(foldText(value)) ?? new Set()
    return [...matches]
  }
}

/**
 * Reads the employees file and resolves it against the directory. Returns `{ lookup, rejected }`:
 * `lookup(label)` → `{ excluded: true }`, `{ id, titleId }` (the professional and her primary
 * title), or null for a label the file does not name; `rejected`: `{ line, reasons }`.
 */
export function readEmployees(text, directory) {
  const { rows } = readTable(text, { columns: EMPLOYEE_COLUMNS, required: ['employee'] })
  const find = professionalIndex(directory)
  const map = new Map(EXCLUDED_EMPLOYEES.map((label) => [foldText(label), { excluded: true }]))
  const seen = new Set()
  const rejected = []
  for (const row of rows) {
    const label = row.get('employee')
    const key = foldText(label)
    const reasons = []
    if (key === '') reasons.push('missing_employee')
    else if (seen.has(key)) reasons.push('duplicate_employee')
    // Seen even when refused: a repeat of a refused line is a duplicate too.
    if (key !== '') seen.add(key)
    const excluded = parseYesNo(row.get('excluded'))
    if (excluded === null) reasons.push('invalid_excluded')
    let target = null
    if (reasons.length === 0 && excluded) target = { excluded: true }
    else if (reasons.length === 0) {
      const wanted = row.get('professional')
      const matches = wanted === '' ? [] : find(wanted)
      if (wanted === '') reasons.push('missing_professional')
      else if (matches.length === 0) reasons.push('unknown_professional')
      else if (matches.length > 1) reasons.push('ambiguous_professional')
      else target = { id: matches[0].id, titleId: matches[0].primary_title_id ?? null }
    }
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons })
      continue
    }
    if (!EXCLUDED_EMPLOYEES.some((label) => foldText(label) === key)) map.set(key, target)
  }
  return { lookup: (label) => map.get(foldText(label)) ?? null, rejected, size: map.size }
}

// --- Services → catalogue codes --------------------------------------------------------------------

export const SERVICE_COLUMNS = {
  service: ['Service', 'Service GOrendezvous', 'Service / Produit', 'Produit', 'Nom du service'],
  code: ['Code', 'Code du catalogue', 'Code MANA', 'Code du service'],
}

/**
 * Reads the services file (GOrendezvous's service names, including the legacy uncoded ones, → a
 * catalogue code). `codes`: the catalogue's codes (`services_catalog.code`). Returns
 * `{ codeFor(line), rejected }`: `codeFor` takes a line of « Revenus par service-produit » and gives
 * its catalogue code (its own code when the catalogue has it, else the file's), or null.
 */
export function readServiceCodes(text, codes) {
  const catalogue = new Set(codes)
  const map = new Map()
  const seen = new Set()
  const rejected = []
  if (text !== undefined) {
    const { rows } = readTable(text, { columns: SERVICE_COLUMNS, required: ['service', 'code'] })
    for (const row of rows) {
      const key = foldText(row.get('service'))
      const code = row.get('code')
      const reasons = []
      if (key === '') reasons.push('missing_service')
      else if (seen.has(key)) reasons.push('duplicate_service')
      if (key !== '') seen.add(key)
      if (!/^[0-9]{5}$/.test(code)) reasons.push('invalid_code')
      else if (!catalogue.has(code)) reasons.push('unknown_code')
      if (reasons.length > 0) rejected.push({ line: row.line, reasons })
      else map.set(key, code)
    }
  }
  const codeFor = (line) => {
    if (line.service_code && catalogue.has(line.service_code)) return line.service_code
    return map.get(foldText(line.service)) ?? null
  }
  return { codeFor, rejected, size: map.size }
}
