/**
 * Socle PUR de la vue Tests, multi-projets.
 *
 * La vue ne doit pas être câblée sur Autowin OS : un projet y est une RACINE quelconque, dont le
 * harnais est DÉDUIT de son `package.json`. Tout ce qui est décidable sans disque ni process vit
 * ici — détection du harnais, lecture du rapport, comptage — pour être testable sans Electron.
 */

export type TestRunner = 'vitest' | 'jest' | 'none'

export interface DetectedRunner {
  runner: TestRunner
  /** Commande à lancer (jamais un shell : argv séparé). */
  command: string
  args: string[]
}

export interface TestProject {
  id: string
  label: string
  root: string
}

export type TestCaseStatus = 'passed' | 'failed' | 'skipped'

export interface TestCase {
  file: string
  name: string
  status: TestCaseStatus
  durationMs?: number
  error?: string
}

export interface TestReport {
  cases: TestCase[]
  /** Renseigné QUAND la sortie n'est pas un rapport lisible : jamais un vert inventé. */
  invalid?: string
}

export interface TestTotals {
  passed: number
  failed: number
  skipped: number
  total: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Le harnais se lit dans les DÉPENDANCES, pas dans le texte du script `test` : un `"test": "echo
 * no tests"` ne doit jamais passer pour une suite exécutable, sinon la vue afficherait un projet
 * qu'elle ne peut pas faire tourner.
 */
export function detectTestRunner(pkg: unknown): DetectedRunner {
  const manifest = record(pkg)
  const deps = {
    ...(record(manifest?.devDependencies) ?? {}),
    ...(record(manifest?.dependencies) ?? {})
  }
  if ('vitest' in deps) {
    return { runner: 'vitest', command: 'npx', args: ['vitest', 'run', '--reporter=json'] }
  }
  if ('jest' in deps) {
    return { runner: 'jest', command: 'npx', args: ['jest', '--json'] }
  }
  return { runner: 'none', command: '', args: [] }
}

/** Fin de l'objet ouvert en `start`, en ignorant les accolades qui vivent DANS une chaine. */
function objectEnd(raw: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i += 1) {
    const c = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Isole le RAPPORT dans une sortie qui porte aussi le bruit de npm/npx et du stderr. Decouper de la
 * premiere `{` a la derniere `}` etait faux des qu'une ligne de bruit portait une accolade : la
 * tranche devenait insyntaxique et un rapport bien present passait pour illisible. On balaie donc
 * les objets equilibres et on retient celui qui porte `testResults` — un objet JSON quelconque
 * (avertissement npm serialise) n'est jamais promu en rapport vide.
 */
function extractJson(raw: string): unknown {
  let fallback: unknown
  for (let i = raw.indexOf('{'); i >= 0; i = raw.indexOf('{', i + 1)) {
    const end = objectEnd(raw, i)
    if (end < 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(i, end + 1))
    } catch {
      continue
    }
    const obj = record(parsed)
    if (obj && Array.isArray(obj.testResults)) return parsed
    if (fallback === undefined) fallback = parsed
    i = end
  }
  return fallback
}

function statusOf(value: unknown): TestCaseStatus {
  const s = String(value ?? '')
  if (s === 'passed') return 'passed'
  if (s === 'failed') return 'failed'
  return 'skipped' // `pending`, `todo`, `skipped` : tout ce qui n'a pas été exécuté
}

/**
 * Rapport JSON de vitest ET de jest : même forme (`testResults[].assertionResults[]`), donc un seul
 * lecteur. Une sortie illisible rend `invalid` — l'appelant affiche l'échec, pas zéro test.
 */
export function parseTestReport(raw: string): TestReport {
  const parsed = record(extractJson(raw ?? ''))
  const files = parsed?.testResults
  if (!parsed || !Array.isArray(files)) {
    return { cases: [], invalid: 'sortie illisible : aucun rapport JSON de test trouvé' }
  }
  const cases: TestCase[] = []
  for (const entry of files) {
    const file = record(entry)
    const nom = typeof file?.name === 'string' ? file.name : ''
    const assertions = Array.isArray(file?.assertionResults) ? file.assertionResults : []
    for (const item of assertions) {
      const a = record(item)
      if (!a) continue
      const messages = Array.isArray(a.failureMessages) ? a.failureMessages.map(String) : []
      cases.push({
        file: nom,
        name: String(a.fullName ?? a.title ?? ''),
        status: statusOf(a.status),
        ...(typeof a.duration === 'number' ? { durationMs: a.duration } : {}),
        ...(messages.length ? { error: messages.join('\n') } : {})
      })
    }
  }
  return { cases }
}

/** Compte les cas RÉELLEMENT lus, jamais le `numTotalTests` déclaré par le harnais. */
export function summarizeReport(report: TestReport): TestTotals {
  const totals: TestTotals = { passed: 0, failed: 0, skipped: 0, total: 0 }
  for (const c of report.cases) {
    totals[c.status] += 1
    totals.total += 1
  }
  return totals
}

function labelOf(root: string): string {
  const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || root
}

export function projectId(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase()
}

/** Registre tolérant : ignore ce qui n'est pas une racine utilisable, dédoublonne, garde l'ordre. */
export function normalizeProjects(entries: unknown): TestProject[] {
  if (!Array.isArray(entries)) return []
  const seen = new Set<string>()
  const projects: TestProject[] = []
  for (const entry of entries) {
    const e = record(entry)
    const root = typeof e?.root === 'string' ? e.root.trim() : ''
    if (!root) continue
    const id = projectId(root)
    if (seen.has(id)) continue
    seen.add(id)
    const label = typeof e?.label === 'string' && e.label.trim() ? e.label.trim() : labelOf(root)
    projects.push({ id, label, root })
  }
  return projects
}
