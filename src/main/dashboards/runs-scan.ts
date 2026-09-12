import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseRun, type RunSummary } from './runs'
import { publicationEnClair } from '../runs/run-interruption'

/**
 * Scanne les RUN.md vivants du kit autowin (~/.claude/runs/<session>/<sujet>-workspace/RUN.md)
 * et renvoie un résumé parsé de chacun — la "visualisation du workflow des skills"
 * (candidat ④). Lecture disque, côté main uniquement.
 */
export interface RunEntry {
  subject: string
  session: string
  path: string
  mtime: number
  summary: RunSummary
  /**
   * Conversation qui a produit ce run, quand elle est connue. La racine des runs ne la porte pas
   * (`<session>` y est un identifiant de session CLI) : le lien vit côté conversations, dans
   * `runPaths`. Sans lui, une ligne de run est un cul-de-sac — on voit « red · sujet » sans pouvoir
   * demander pourquoi.
   */
  conversationId?: string
  /**
   * État de PUBLICATION du travail de cette conversation, quand il est sans ambiguïté
   * (`held` = retenu, `blocked` = bloqué). Distinct du statut du RUN.md : un run peut être `green`
   * avec sa DoD complète ET son intégration retenue — c'est ce cas qui était invisible.
   */
  publication?: string
  /** Le même état en clair, dans le vocabulaire de `run-interruption` (une seule source). */
  publicationLabel?: string
}

/** États de publication qui réclament une attention : les seuls que le rail a besoin de nommer. */
const PUBLICATIONS_EN_ATTENTE = new Set(['held', 'blocked'])

/**
 * Rattache à chaque run l'état de publication de sa conversation, SANS jamais le deviner.
 *
 * Un RUN.md ne porte ni `runId` ni état de publication : le seul lien disponible est la
 * conversation. On n'attache donc l'état que si la conversation a EXACTEMENT UN travail en attente
 * (`held`/`blocked`) — au-delà, on ne saurait pas dire lequel des runs est concerné, et on préfère
 * ne rien afficher plutôt qu'attribuer un blocage au mauvais run.
 */
export function attachPublicationStates(
  entries: RunEntry[],
  records: readonly { conversationId?: string; publication: string }[]
): RunEntry[] {
  const enAttente = new Map<string, string[]>()
  for (const record of records) {
    if (!record.conversationId || !PUBLICATIONS_EN_ATTENTE.has(record.publication)) continue
    const deja = enAttente.get(record.conversationId) ?? []
    deja.push(record.publication)
    enAttente.set(record.conversationId, deja)
  }
  if (enAttente.size === 0) return entries
  return entries.map((entry) => {
    const cle = entry.conversationId ?? entry.session
    const etats = enAttente.get(cle)
    if (!etats || etats.length !== 1) return entry
    return { ...entry, publication: etats[0], publicationLabel: publicationEnClair(etats[0]) }
  })
}

/**
 * Rattache chaque run à la conversation dont les `runPaths` le citent. Comparaison sur chemin
 * NORMALISÉ (casse ignorée sous Windows), comme `deleteListedRun`.
 */
export function attachConversationIds(
  entries: RunEntry[],
  conversations: readonly { id: string; runPaths?: string[] }[]
): RunEntry[] {
  const parConversation = new Map<string, string>()
  for (const conversation of conversations) {
    for (const runPath of conversation.runPaths ?? []) {
      parConversation.set(comparablePath(runPath), conversation.id)
    }
  }
  if (parConversation.size === 0) return entries
  return entries.map((entry) => {
    const conversationId = parConversation.get(comparablePath(entry.path))
    return conversationId ? { ...entry, conversationId } : entry
  })
}

/** Racine des runs (override possible via AUTOWIN_RUN_ROOT). */
export function runsRoot(): string {
  if (process.env.AUTOWIN_RUN_ROOT) return process.env.AUTOWIN_RUN_ROOT
  return join(process.env.USERPROFILE ?? '.', '.claude', 'runs')
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p)
  } catch {
    return []
  }
}

export interface ScanRunsOptions {
  /** Nombre maximum de RUN.md RÉELLEMENT lus et parsés (les plus récents d'abord). */
  limit?: number
  /** Restreint la traversée à ces sessions/conversations. Absent = toutes. */
  sessions?: string[]
}

export interface ScanRunsResult {
  entries: RunEntry[]
  /** Candidats écartés par la borne. > 0 = la liste est TRONQUÉE, jamais en silence. */
  remaining: number
}

/**
 * Découvre et parse les RUN.md sous la racine, plus récent d'abord — avec une borne qui porte
 * sur les LECTURES, pas seulement sur la sortie.
 *
 * Pourquoi la borne ne pouvait pas rester un simple `slice` : la version précédente lisait et
 * parsait TOUS les fichiers puis tranchait. Sur la racine dev mesurée le 2026-08-18 (11 784
 * RUN.md), cela coûtait ~15 s à froid pour n'en garder que quelques dizaines — et `listConvRuns`
 * payait ce prix à chaque affichage d'une conversation. On stat d'abord (cheap), on trie, et on
 * ne `readFile` que les `limit` plus récents.
 */
export async function scanRunsBounded(
  root = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<ScanRunsResult> {
  const sessionFilter = options.sessions ? new Set(options.sessions) : undefined
  const sessions = sessionFilter
    ? (await safeReaddir(root)).filter((s) => sessionFilter.has(s))
    : await safeReaddir(root)

  const candidates: { subject: string; session: string; path: string; mtime: number }[] = []
  for (const session of sessions) {
    const sessionDir = join(root, session)
    for (const ws of await safeReaddir(sessionDir)) {
      const runPath = join(sessionDir, ws, 'RUN.md')
      try {
        const runStat = await stat(runPath)
        candidates.push({
          subject: ws.replace(/-workspace$/, ''),
          session,
          path: runPath,
          mtime: runStat.mtimeMs
        })
      } catch {
        /* pas de RUN.md ici — ignoré */
      }
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  const limit =
    options.limit === undefined ? candidates.length : Math.max(0, Math.floor(options.limit))
  const retenus = candidates.slice(0, limit)

  const entries: RunEntry[] = []
  for (const candidate of retenus) {
    try {
      const md = await readFile(candidate.path, 'utf8')
      entries.push({ ...candidate, summary: parseRun(md, candidate.subject) })
    } catch {
      /* run illisible — ignoré */
    }
  }

  return { entries, remaining: candidates.length - retenus.length }
}

/** Variante historique : la liste seule. */
export async function scanRuns(
  root = runsRoot(),
  options: ScanRunsOptions = {}
): Promise<RunEntry[]> {
  return (await scanRunsBounded(root, options)).entries
}

function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

/** Supprime uniquement un workspace dont le RUN.md figure encore dans le scan global courant. */
export async function deleteListedRun(runPath: string, root = runsRoot()): Promise<void> {
  const candidate = comparablePath(runPath)
  const listedRun = (await scanRuns(root)).find((run) => comparablePath(run.path) === candidate)
  if (!listedRun) throw new Error('RUN non autorisé dans la liste globale')
  await rm(dirname(listedRun.path), { recursive: true, force: false })
}

/**
 * Borne du scan sur le CHEMIN CHAUD (`snapshot()` d'un tour de chat).
 *
 * Mesure du 2026-08-28 (onglet Latence, 1 290 tours réels) : le segment `snapshot` coûtait p95
 * 1 288 ms et jusqu'à 19 250 ms par tour, parce que `runsWithGate()` scannait TOUS les RUN.md pour
 * n'en garder que 12. 24 laisse une marge franche au-dessus de ce que le snapshot affiche, sans
 * jamais payer la racine entière.
 */
export const LIMITE_RUNS_SNAPSHOT = 24

/** Variante BORNÉE destinée au chemin chaud — jamais `scanRuns()` sans borne. */
export function scanRunsPourSnapshot(root = runsRoot()): Promise<RunEntry[]> {
  return scanRuns(root, { limit: LIMITE_RUNS_SNAPSHOT })
}
