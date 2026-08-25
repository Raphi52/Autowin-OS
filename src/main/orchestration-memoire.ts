import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clip } from './conversation-window'

/**
 * MÉMOIRE INTER-RUNS D'UNE CONVERSATION — ce qu'un run doit hériter du précédent.
 *
 * Défaut mesuré (conv-1405) : le chaînage de phases est INTRA-run (`phaseOutputs`), et le seul
 * texte qui traverse vers un nouveau run est la tâche. Les objections du juge meurent donc avec
 * leur run : le run suivant de la même conversation refait la même erreur, et l'utilisateur doit
 * recopier les findings à la main. Symétriquement, seule la FIN du fil est reprise
 * (`CONTEXT_MESSAGE_LIMIT`) : tout ce qui précède est perdu, sans même une trace d'une ligne.
 *
 * Ce module est PUR lecture et sans dépendance au moteur : il lit les RUN.md déjà écrits par
 * `conv-runs.ts` (section `## Livrable des phases` → `### phase judge`) et rend des données
 * bornées, prêtes à être rendues dans le contexte d'orchestration.
 */

/** Findings d'un run : le verdict du juge et ses objections, telles qu'écrites. */
export interface FindingsDuJuge {
  verdict?: string
  findings: string[]
}

const MAX_FINDINGS = 8
const MAX_FINDING_CHARS = 240

/**
 * Extrait la section `### phase judge` du RUN.md et n'en garde que les puces.
 *
 * Volontairement ancré sur la SEULE section du juge : un ramassage sur tout le markdown
 * remonterait les « ## Défauts » notés par la phase build, qui ne sont pas des objections de juge.
 */
export function findingsDuJuge(md: string): FindingsDuJuge {
  const section = md.match(
    /(?:^|\n)###\s+phase\s+(?:judge|juge)\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i
  )
  if (!section) return { findings: [] }
  const texte = section[1]
  const verdict = texte.match(/verdict\s*[:—-]\s*([A-Za-zÀ-ÿ_ -]{2,40})/i)?.[1]?.trim()
  const findings = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => clip(l.replace(/^[-*•]\s+/, ''), MAX_FINDING_CHARS))
    .filter(Boolean)
    .slice(0, MAX_FINDINGS)
  return verdict ? { verdict, findings } : { findings }
}

/** Un run passé de la conversation, réduit à ce qui sert au run suivant. */
export interface RunPasse extends FindingsDuJuge {
  besoin: string
  status: string
  path: string
}

function besoinDuRun(md: string): string {
  const brut =
    md.match(/##\s+Besoin\s*\n([\s\S]*?)\n\s*\*\*Critere de succes/i)?.[1] ??
    md.match(/##\s+Besoin\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1] ??
    ''
  return clip(brut, 200)
}

/**
 * Runs PRÉCÉDENTS de la conversation, du plus récent au plus ancien.
 *
 * `exclureRunPath` retire le run COURANT : sa section juge n'existe pas encore, et s'y référer
 * ferait boucler la mémoire sur elle-même. Le scan est borné au dossier de la conversation —
 * aucune autre conversation n'est lue, donc aucune fuite entre fils.
 */
export function memoireDesRunsPrecedents(
  root: string,
  convId: string,
  options: { exclureRunPath?: string; max?: number } = {}
): RunPasse[] {
  const max = options.max ?? 3
  const dossier = join(root, convId)
  let workspaces: string[]
  try {
    workspaces = readdirSync(dossier)
  } catch {
    return [] // conversation sans aucun run : absence de mémoire, jamais une erreur
  }
  const candidats: Array<{ path: string; mtime: number; workspace: string }> = []
  for (const workspace of workspaces) {
    const path = join(dossier, workspace, 'RUN.md')
    if (options.exclureRunPath && join(path) === join(options.exclureRunPath)) continue
    try {
      candidats.push({ path, mtime: statSync(path).mtimeMs, workspace })
    } catch {
      /* workspace sans RUN.md lisible : ignoré, il n'empêche pas les autres */
    }
  }
  // Le nom du workspace porte un suffixe horodaté (base36) : il départage deux RUN.md écrits
  // dans la même milliseconde, où `mtime` seul rendrait un ordre non déterministe.
  candidats.sort((a, b) => b.mtime - a.mtime || b.workspace.localeCompare(a.workspace))
  const memoire: RunPasse[] = []
  for (const candidat of candidats) {
    if (memoire.length >= max) break
    let md: string
    try {
      md = readFileSync(candidat.path, 'utf8')
    } catch {
      continue
    }
    const juge = findingsDuJuge(md)
    if (!juge.verdict && !juge.findings.length) continue // rien à transmettre
    memoire.push({
      ...juge,
      besoin: besoinDuRun(md),
      status: md.match(/^status:\s*(\S+)/m)?.[1] ?? 'unknown',
      path: candidat.path
    })
  }
  return memoire
}

const MAX_RESUME_TOURS = 30
const MAX_RESUME_CHARS = 180

/**
 * Résumé d'UNE LIGNE par tour ANTÉRIEUR à la fenêtre reprise intégralement.
 *
 * Les `fenetre` derniers messages sont déjà transmis en entier par `orchestration-context` : les
 * redoubler ici ne ferait que consommer du budget. Ce qui manquait, c'est tout ce qui est AVANT —
 * perdu sans trace. Une ligne clippée par tour est le minimum honnête : elle ne prétend pas
 * résumer, elle empêche l'oubli total.
 */
export function resumeDesTours(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  fenetre: number
): string[] {
  const anciens = messages.slice(0, Math.max(0, messages.length - fenetre))
  if (!anciens.length) return []
  return anciens
    .slice(-MAX_RESUME_TOURS)
    .map((m) => `${m.role === 'user' ? 'U' : 'A'}: ${clip(m.content, MAX_RESUME_CHARS)}`)
}
