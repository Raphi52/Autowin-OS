// Parseur de RUN.md pour le dashboard des runs vivants (candidat ④/visu workflow).

import { estArretParStop } from '../../shared/arret-par-stop'
import { estMurDeQuota } from '../../shared/reprise-quota'
import type { RunInterruption } from '../../shared/run-blocked'

/** Résumé normalisé d'un RUN.md pour affichage dashboard. */
export type RunSummary = {
  status:
    | 'pending'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'open'
    | 'red'
    | 'green'
    | 'degraded-closed'
    | 'interrupted'
    | 'unknown'
  regime?: string
  dodTotal: number
  dodChecked: number
  journalEvents: number
  defauts: number
  subject?: string
  /** Run rouge parce qu'il a été COUPÉ (Stop du chat, quota), pas parce que le travail a échoué. */
  interruption?: RunInterruption
}

const STATUSES = new Set([
  'pending',
  'running',
  'succeeded',
  'failed',
  'open',
  'red',
  'green',
  'degraded-closed',
  // Coupé de l'extérieur (Stop, quota, panne) : sans lui ici, il serait relu `unknown`, donc
  // bloqué — exactement le défaut qu'il corrige (piste 4, conv-1070).
  'interrupted'
])

/**
 * Extrait les lignes d'une section `## Heading` jusqu'au prochain heading `## `
 * (ou la fin du document).
 */
function extractSection(lines: string[], heading: string): string[] {
  // Match le heading exact OU avec un suffixe (« ## Besoin (Phase 1 — …) ») :
  // sinon un titre de section annoté ferait rater tout le contenu (DoD 0/0).
  const startIdx = lines.findIndex((l) => {
    const t = l.trim()
    return t === heading || t.startsWith(heading + ' ')
  })
  if (startIdx === -1) return []

  const section: string[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) break
    section.push(line)
  }
  return section
}

/** La ligne qu'écrit `closeConvRun` quand l'orchestration lève (`commands.ts`, « Orchestration en échec »). */
const CLOTURE_EN_ECHEC = /^\[\d{4}-\d{2}-\d{2}\] Orchestration en échec: (.*)$/

/**
 * POURQUOI CE RUN ROUGE S'EST ARRÊTÉ — lu dans sa ligne de clôture, et elle seule (conv-1069).
 *
 * Le 2026-10-22, la liste des runs « bloqués » servie à chaque tour comptait des runs coupés par le
 * bouton Stop (conv-1058) ou par le quota (conv-1056) : rien à réparer dans le code. Le RUN.md n'a
 * pas d'autre trace de la cause que cette ligne. `closeConvRun` l'insère EN TÊTE du journal : la
 * première trouvée est la plus récente — un run suspendu puis repris jusqu'à un vrai défaut est un
 * échec. Un texte de quota ou de Stop CITÉ ailleurs dans le journal ne compte pas.
 *
 * `ligneJournalDErreur` a replié les retours à la ligne de l'erreur en « · » : on les rétablit pour
 * que `estArretParStop` retrouve une ligne par modèle et la fin du motif. Le quota l'emporte sur le
 * Stop : un modèle tombé sur son quota avant le Stop d'un autre n'est pas un arrêt voulu.
 */
function interruptionDeCloture(journal: string[]): RunInterruption | undefined {
  for (const ligne of journal) {
    const erreur = CLOTURE_EN_ECHEC.exec(ligne.trim())?.[1]
    if (erreur === undefined) continue
    if (estMurDeQuota(erreur)) return 'quota'
    return estArretParStop(erreur.replace(/ · /g, '\n')) ? 'stop' : undefined
  }
  return undefined
}

/**
 * Parse un RUN.md (format kit Autowin) en RunSummary.
 * - status/regime lus depuis les lignes `status: X` / `regime: X`.
 * - DoD compté sous `## Besoin` (cases `- [ ]` / `- [x]`).
 * - journalEvents = lignes commençant par `[` sous `## Journal`.
 * - defauts = lignes non vides/non-commentaire sous `## Défauts`.
 */
export function parseRun(md: string, subject?: string): RunSummary {
  const lines = md.split(/\r?\n/)

  let status: RunSummary['status'] = 'unknown'
  let regime: string | undefined

  // status/regime ne sont lus que dans le HEADER (avant le 1er heading `## `) :
  // sinon un `status:` en texte libre dans le Journal fausserait le dashboard.
  const firstHeading = lines.findIndex((l) => l.startsWith('## '))
  const headerLines = firstHeading === -1 ? lines : lines.slice(0, firstHeading)

  for (const line of headerLines) {
    const statusMatch = line.match(/^\s*status:\s*(\S+)/i)
    if (statusMatch && status === 'unknown') {
      const value = statusMatch[1].toLowerCase()
      if (STATUSES.has(value)) {
        status = value as RunSummary['status']
      }
    }

    const regimeMatch = line.match(/^\s*regime:\s*(\S+)/i)
    if (regimeMatch && regime === undefined) {
      regime = regimeMatch[1]
    }
  }

  const besoinLines = extractSection(lines, '## Besoin')
  let dodTotal = 0
  let dodChecked = 0
  for (const line of besoinLines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
      dodTotal++
      dodChecked++
    } else if (trimmed.startsWith('- [ ]')) {
      dodTotal++
    }
  }

  const journalLines = extractSection(lines, '## Journal')
  const journalEvents = journalLines.filter((l) => l.trim().startsWith('[')).length

  const defautsLines = extractSection(lines, '## Défauts')
  const defauts = defautsLines.filter((l) => {
    const trimmed = l.trim()
    return trimmed.length > 0 && !trimmed.startsWith('<!--') && !trimmed.startsWith('//')
  }).length

  const interruption = status === 'red' ? interruptionDeCloture(journalLines) : undefined

  return {
    status,
    regime,
    dodTotal,
    dodChecked,
    journalEvents,
    defauts,
    subject,
    ...(interruption ? { interruption } : {})
  }
}

// La règle du « bloqué » vit dans `src/shared/run-blocked.ts` : l'interface en a besoin aussi,
// et elle n'a pas à importer du code du processus principal pour l'obtenir.
export { isBlocked } from '../../shared/run-blocked'
