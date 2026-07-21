import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseRun } from '../dashboards/runs'
import { scanRuns, type RunEntry } from '../dashboards/runs-scan'
import type { OrchestrationStep } from '../orchestrator'
import { ensureAutowinAppData } from '../app-data'

/**
 * RUN.md PAR CONVERSATION — chaque tâche/orchestration lancée depuis une conversation
 * laisse son workflow dans `%APPDATA%\autowin-os\runs\<convId>\<slug>-workspace\RUN.md`,
 * au FORMAT autowin (status/DoD/Journal) : le parseur existant (parseRun/scanRuns) les
 * lit tels quels. Volontairement HORS de ~/.claude/runs (aucun conflit avec les hooks du kit).
 */

export function convRunsRoot(): string {
  return join(ensureAutowinAppData(), 'runs')
}

function slugify(task: string): string {
  const s = task
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'tache'
}

/** Crée le RUN.md (status: open) d'une tâche lancée depuis une conversation. */
export function createConvRun(
  convId: string,
  task: string,
  root = convRunsRoot(),
  now: () => number = () => Date.now()
): string {
  // suffixe horodaté → pas de collision si la même tâche est relancée
  const dir = join(root, convId, `${slugify(task)}-${now().toString(36)}-workspace`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'RUN.md')
  const date = new Date(now()).toISOString().slice(0, 10)
  writeFileSync(
    path,
    `status: open
session: ${convId}
regime: standard
signal: verdict du juge + gate déterministe (orchestration in-app)

## Besoin
${task}

**Critere de succes (DoD cochable)** :
  - [ ] le juge valide le résultat et le gate autorise la clôture

## Contraintes
<!-- bornes de la solution (HARD/SOFT), source + conséquence si violée -->

## Options
<!-- si un choix d'approche est engagé : >=3 options scorées + ligne Décision -->

## SOP
<!-- terrain : procédure opératoire spécifique à la tâche — action -> commande/outil -> signal attendu -> fallback/arrêt -->

## Journal
[${date}] Orchestration lancée depuis la conversation ${convId}.

## Défauts

## Reprise
Goal:
Hypothesis:
Tried:
Next:
Blockers:

## Cicatrices

## Checks
`,
    'utf8'
  )
  return path
}

/** Extrait le contenu d'une section `## Nom` d'un markdown (jusqu'à la prochaine `## ` ou la fin). */
function extractSection(md: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

/**
 * J2 — peuple le RUN.md de la conversation avec le VRAI livrable des phases : le sous-agent
 * produit son travail structuré (Contraintes/Options/SOP…) dans sa réponse, mais le RUN.md que
 * Workflows affiche restait un template vide. On remplit les placeholders `<!-- -->` avec le
 * meilleur contenu (le plus complet) trouvé sur l'ensemble des phases, et on annexe l'agrégat.
 */
export function populateConvRunSections(
  runPath: string,
  phaseOutputs: { phase: string; text: string }[]
): void {
  if (!phaseOutputs?.length) return
  try {
    let md = readFileSync(runPath, 'utf8')
    for (const section of ['Contraintes', 'Options', 'SOP']) {
      // le contenu le plus long parmi les phases = le plus complet (résiste à une phase qui dérive)
      const best = phaseOutputs
        .map((p) => extractSection(p.text, section))
        .filter((c) => c && !c.startsWith('<!--'))
        .sort((a, b) => b.length - a.length)[0]
      if (!best) continue
      const placeholder = new RegExp(`(##\\s+${section}\\n)<!--[\\s\\S]*?-->`, 'i')
      if (placeholder.test(md)) md = md.replace(placeholder, `$1${best}`)
    }
    const annexe = phaseOutputs
      .map((p) => `### phase ${p.phase}\n${p.text.slice(0, 2000)}`)
      .join('\n\n')
    const section = `## Livrable des phases\n${annexe}\n`
    if (md.includes('## Livrable des phases')) {
      // A3 — peuplement LIVE : la section est réécrite à chaque phase (idempotent), pas dupliquée.
      md = md.replace(/## Livrable des phases\n[\s\S]*?(?=\n## Reprise)/, section)
    } else {
      md = md.replace(/\n## Reprise/, `\n${section}\n## Reprise`)
    }
    writeFileSync(runPath, md, 'utf8')
  } catch {
    /* peuplement best-effort : un RUN.md template reste lisible, pas fatal */
  }
}

/** Clôt le RUN selon le verdict du gate (green = validé, red = rejeté/crash). */
export function closeConvRun(path: string, green: boolean, journalLine: string): void {
  try {
    let md = readFileSync(path, 'utf8')
    md = md.replace(/^status: open/m, `status: ${green ? 'green' : 'red'}`)
    if (green) md = md.replace(/^ {2}- \[ \] (le juge valide.*)$/m, '  - [x] $1')
    md = md.replace(/^## Journal$/m, `## Journal`)
    md = md.replace(
      /(## Journal\n)/,
      `$1[${new Date().toISOString().slice(0, 10)}] ${journalLine}\n`
    )
    writeFileSync(path, md, 'utf8')
  } catch {
    /* clôture best-effort : un RUN resté open est visible, pas fatal */
  }
}

/** Chemin du sidecar de trace (fil des sous-agents) d'un RUN.md. */
function tracePath(runPath: string): string {
  return join(dirname(runPath), 'trace.json')
}

const STEP_TEXT_CAP = 4000

/**
 * Persiste le FIL des sous-agents (exec/juge/gate avec contenu) à côté du RUN.md.
 * Sidecar JSON séparé → ne casse pas le format autowin du .md. Contenu cappé.
 */
export function saveConvRunTrace(runPath: string, steps: OrchestrationStep[]): void {
  try {
    const trimmed = steps.map((s) => ({
      ...s,
      text: s.text && s.text.length > STEP_TEXT_CAP ? `${s.text.slice(0, STEP_TEXT_CAP)}…` : s.text
    }))
    writeFileSync(tracePath(runPath), JSON.stringify(trimmed), 'utf8')
  } catch {
    /* la trace est un bonus d'affichage : son échec ne casse rien */
  }
}

/** Relit le fil des sous-agents d'un run (null si absent/illisible). */
export function loadConvRunTrace(runPath: string): OrchestrationStep[] | null {
  try {
    const p = tracePath(runPath)
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(data) ? (data as OrchestrationStep[]) : null
  } catch {
    return null
  }
}

/** Runs d'UNE conversation : ceux créés dans son dossier + les RUN.md attachés. */
export function listConvRuns(
  convId: string,
  attachedPaths: string[] = [],
  root = convRunsRoot()
): RunEntry[] {
  const own = scanRuns(join(root)).filter((r) => r.session === convId)
  const attached: RunEntry[] = []
  for (const p of attachedPaths) {
    if (!existsSync(p)) continue
    try {
      const md = readFileSync(p, 'utf8')
      const subject = dirname(p)
        .split(/[\\/]/)
        .pop()!
        .replace(/-workspace$/, '')
      attached.push({
        subject,
        session: 'attaché',
        path: p,
        mtime: statSync(p).mtimeMs,
        summary: parseRun(md, subject)
      })
    } catch {
      /* run attaché illisible — ignoré */
    }
  }
  return [...own, ...attached].sort((a, b) => b.mtime - a.mtime)
}
