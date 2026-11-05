import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { appendFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureAutowinAppData } from '../app-data'
import { redactTrace } from './trace-redact'
import type { BrainNavigation, BrainUnavailableReason } from '../brain-retrieval'

/**
 * SPOOL DE TRACES BRAIN (observabilité Observatory) — Autowin enregistre, par run, ce que le Brain
 * a fait : la requête réelle envoyée, la navigation interne (candidats parcourus/scorés/retenus) et
 * les caractères injectés. Append-only JSONL, rotation ~2 Mo. Requête redactée (peut contenir des
 * secrets de tâche). Distinct du spool de traces natif (pré-requête provider).
 */
const SPOOL_MAX_BYTES = 2 * 1024 * 1024
const ARCHIVE_MAX_BYTES = 8 * 1024 * 1024
const MAX_QUERY_CHARS = 16_000
const MAX_ENTRY_BYTES = 512 * 1024
const latestTraceIds = new Map<string, string>()

/** Sante du spool Brain, lisible sans jamais jeter. `enBonneSante` est faux des la premiere perte. */
interface SanteSpoolBrain {
  tracesPerdues: number
  derniereErreur?: string
  enBonneSante: boolean
}

// Le tracage ne doit jamais casser l'action tracee, mais sa perte ne doit pas etre invisible :
// un spool totalement mort se lisait comme un spool vide, et l'Observatory presentait une
// chronologie incomplete en la donnant pour complete. Meme parti pris que TraceLedger.sante().
let tracesPerdues = 0
let dernierePerte: string | undefined

/** Etat du spool de traces Brain (compteurs de perte), lisible sans jamais jeter. */
export function brainTraceSpoolHealth(): SanteSpoolBrain {
  return {
    tracesPerdues,
    ...(dernierePerte ? { derniereErreur: dernierePerte } : {}),
    enBonneSante: tracesPerdues === 0
  }
}

function correlationKey(base: string, conversationId: string, turnId: string): string {
  return `${resolve(base)}\u0000${conversationId}\u0000${turnId}`
}

function boundedRedactedTrace(trace: BrainTrace): BrainTrace {
  const query = String(redactTrace(trace.query) ?? '').slice(0, MAX_QUERY_CHARS)
  const navigation = trace.navigation
    ? {
        ...trace.navigation,
        query: String(redactTrace(trace.navigation.query) ?? '').slice(0, MAX_QUERY_CHARS),
        root: trace.navigation.root?.slice(0, 4_096),
        candidates: trace.navigation.candidates.slice(0, 100).map((candidate) => ({
          ...candidate,
          path: candidate.path.slice(0, 4_096),
          type: candidate.type.slice(0, 256),
          relations: candidate.relations
            ?.slice(0, 20)
            .map((relation) => ({ ...relation, target: relation.target.slice(0, 4_096) }))
        }))
      }
    : undefined
  const notes = trace.notes?.slice(0, 20).map((note) => String(note).slice(0, 400))
  const bounded: BrainTrace = {
    ...trace,
    query,
    ...(navigation ? { navigation } : {}),
    ...(notes ? { notes } : {})
  }
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= MAX_ENTRY_BYTES) return bounded
  // La navigation est reconstructible depuis Brain. L'identite, l'issue et les compteurs du run ne
  // le sont pas : on conserve ceux-ci plutot que de laisser une entree geante casser la retention.
  delete bounded.navigation
  return bounded
}

/** Génération précédente de l'archive : `events.archive.jsonl` → `events.archive.1.jsonl`. */
function previousArchivePath(archivePath: string): string {
  return archivePath.replace(/\.jsonl$/, '.1.jsonl')
}

/**
 * AJOUT EN FIN D'ARCHIVE, JAMAIS RELECTURE-RÉÉCRITURE INTÉGRALE.
 *
 * La version précédente rechargeait TOUTE l'archive (jusqu'à ARCHIVE_MAX_BYTES), y concaténait le
 * segment, puis réécrivait le fichier entier : jusqu'à 10 Mo lus et 8 Mo réécrits pour ajouter
 * quelques kilo-octets, sur le thread principal. L'archive est donc désormais un anneau de DEUX
 * générations, chacune plafonnée à la moitié de ARCHIVE_MAX_BYTES : le plafond global est le même,
 * mais le coût par rotation devient celui du seul segment.
 *
 * La coupe se fait à la frontière d'un FICHIER, donc jamais au milieu d'une ligne JSONL : aucune
 * ligne partielle ne peut subsister en tête. La perte reste bornée à la génération la plus ancienne.
 */
function appendBoundedArchive(archivePath: string, segmentPath: string): void {
  const segmentBytes = existsSync(segmentPath) ? statSync(segmentPath).size : 0
  if (segmentBytes === 0) return
  const currentBytes = existsSync(archivePath) ? statSync(archivePath).size : 0
  if (currentBytes > 0 && currentBytes + segmentBytes > ARCHIVE_MAX_BYTES / 2) {
    renameSync(archivePath, previousArchivePath(archivePath))
  }
  appendFileSync(archivePath, readFileSync(segmentPath))
}

export interface BrainTrace {
  /** Identité de récupération ; absente uniquement sur les traces historiques. */
  id?: string
  timestamp: string
  conversationId: string
  /** Absent uniquement sur les traces historiques antérieures à la corrélation par tour. */
  turnId?: string
  /**
   * NATURE de l'aller-retour Brain. Les trois dernières valeurs sont arrivées le 2026-08-31 avec
   * les appels qu'elles nomment : ils existaient déjà mais n'écrivaient AUCUNE trace, si bien que
   * l'Observatory présentait une chronologie Brain incomplète en la donnant pour complète.
   *  - `automatic`  : contexte préchargé au démarrage d'un run ;
   *  - `query`      : commande `brain_query` explicite du modèle ;
   *  - `empreinte`  : ancien chargement de l'empreinte du dépôt, 1×/run — RETIRÉ le 2026-09-27,
   *    la valeur reste pour lire les traces historiques ;
   *  - `recherche`  : recherche lancée par l'HUMAIN depuis la vue Knowledge ;
   *  - `depot`      : ÉCRITURE — dépôt d'un fait en `inbox/` par la commande `remember`.
   *  - `pousse`     : contexte Brain poussé dans le prompt d'un tour de chat, HORS run (arrivée le
   *                   2026-09-06 : ce chemin injectait sans écrire aucune trace).
   *  - `lecture`    : `brain_read` (note entière) ou `brain_graph` (liens) demandés par le modèle
   *                   (conv-1303, 2026-10-30 : 148 notes entières, 347 000 caractères injectés du
   *                   22 au 30/10 sans aucune trace — le plus gros flux Brain, invisible).
   */
  kind?: 'automatic' | 'query' | 'empreinte' | 'recherche' | 'depot' | 'pousse' | 'lecture'
  /**
   * Identifiant du point du registre (`brain-injection-points.ts`) qui a emis la trace. Absent sur
   * les traces historiques : l'inventaire retombe alors sur le `kind`, et refuse de deviner quand
   * ce `kind` designe PLUSIEURS points — une trace mal attribuee vaut moins qu'une trace comptee a
   * part.
   */
  point?: string
  query: string
  found?: boolean
  status?: 'found' | 'empty' | 'invalid' | 'unavailable'
  /**
   * POURQUOI `unavailable`, et combien de temps l'appel a pris — conv-1053 (2026-10-22). Sans eux,
   * départager un délai dépassé d'un refus du serveur a demandé de recouper chaque trace avec
   * l'heure de début de son tour. Absents sur les traces historiques et sur les points qui ne les
   * renseignent pas encore.
   */
  unavailableReason?: BrainUnavailableReason
  durationMs?: number
  injectedChars: number
  navigation?: BrainNavigation
  /**
   * CHEMINS EXACTS des notes injectées (conv-1303, 2026-10-30) : servies par les notes proches du
   * tour, ouvertes par `brain_read`. Sans eux, savoir quelle note a été servie puis ouverte
   * obligeait à rejouer les seuils de sélection sur `navigation` — faux dès que la sélection change.
   */
  notes?: string[]
}

export function brainSpoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'brain-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/**
 * ÉCRIRE UNE TRACE SANS TENIR LA FENÊTRE (conv-1598, 2026-11-05).
 *
 * `gels.jsonl`, matinée du 05/11 : `appendFileSync` de la ligne d'une trace a figé la fenêtre 29 s,
 * quatre appels disque bloquants par trace, sur un SSD inactif à 93 % — le mur est au-dessus du disque
 * (`scripts/trace-blocage-disque.ps1`). Même remède que `conversation-file-trace-spool.ts` : la ligne
 * part sur le pool d'E/S de Node, une seule écriture en route par journal pour garder l'ORDRE, et les
 * lignes pas encore posées restent LISIBLES (`enAttente`) : `readBrainTraces` les recolle.
 *
 * Reste SYNCHRONE : la rotation au-delà de SPOOL_MAX_BYTES (une fois tous les 2 Mo, atomique pour les
 * lecteurs, qui lisent les quatre fichiers) et la fermeture (`flushBrainTraces`, dans `before-quit`).
 * Une écriture refusée est COMPTÉE perdue, comme avant ; une mort BRUTALE du processus perd les
 * traces pas encore posées. Garde : `brain-trace-spool.sans-gel.test.ts`.
 */
const enAttente = new Map<string, string[]>()
const ecritures = new Map<string, Promise<void>>()

function lignesEnAttente(journal: string): string[] {
  return enAttente.get(journal) ?? []
}

function compterPerte(lignes: number, erreur: unknown): void {
  tracesPerdues += lignes
  dernierePerte = (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500)
}

/** La rotation d'avant, inchangée : `events.jsonl` passe en `events.previous.jsonl`. */
function tournerLeSpool(root: string, journal: string): void {
  const previous = join(root, 'events.previous.jsonl')
  if (existsSync(previous)) {
    appendBoundedArchive(join(root, 'events.archive.jsonl'), previous)
    rmSync(previous, { force: true })
  }
  renameSync(journal, previous)
}

function planifierEcriture(root: string, journal: string): void {
  // Une écriture déjà en route reprendra, à sa fin, les lignes arrivées entre-temps.
  if (ecritures.has(journal)) return
  const lot = [...lignesEnAttente(journal)]
  if (lot.length === 0) return
  const contenu = lot.join('')
  const ecriture = (async () => {
    try {
      await mkdir(root, { recursive: true })
      const taille = await stat(journal).then(
        (infos) => infos.size,
        () => 0
      )
      if (taille > 0 && taille + Buffer.byteLength(contenu, 'utf8') > SPOOL_MAX_BYTES) {
        tournerLeSpool(root, journal)
      }
      await appendFile(journal, contenu, 'utf8')
    } catch (erreur) {
      // Le traçage ne casse jamais l'action tracée, mais sa perte reste comptée (comme avant).
      compterPerte(lot.length, erreur)
    }
    const reste = lignesEnAttente(journal).slice(lot.length)
    if (reste.length === 0) enAttente.delete(journal)
    else enAttente.set(journal, reste)
  })().finally(() => {
    ecritures.delete(journal)
    planifierEcriture(root, journal)
  })
  ecritures.set(journal, ecriture)
}

/**
 * Pose sur place, en BLOQUANT, les traces pas encore posées — réservé à la fermeture de l'app. Une
 * ligne dont l'écriture était déjà en route peut alors être posée deux fois : `readBrainTraces`
 * n'en garde qu'une (même identifiant).
 */
export function flushBrainTraces(): void {
  for (const [journal, lignes] of [...enAttente.entries()]) {
    enAttente.delete(journal)
    if (lignes.length === 0) continue
    try {
      appendFileSync(journal, lignes.join(''), 'utf8')
    } catch (erreur) {
      compterPerte(lignes.length, erreur)
    }
  }
}

/** Attend que les traces en route soient posées. Pour les TESTS : la production n'attend jamais. */
export async function attendreEcrituresTracesBrain(): Promise<void> {
  while (ecritures.size > 0) await Promise.all([...ecritures.values()])
}

/** Écrit une trace Brain (append-only, ne jette jamais — l'observabilité n'interrompt pas un run). */
export function appendBrainTrace(
  trace: BrainTrace,
  base = ensureAutowinAppData()
): BrainTrace | undefined {
  try {
    const identified = trace.id ? trace : { ...trace, id: randomUUID() }
    const redacted = boundedRedactedTrace(identified)
    const line = `${JSON.stringify(redacted)}\n`
    // Aucun appel disque ici : le dossier se crée dans l'écriture, hors du fil (conv-1598).
    const root = join(base, 'brain-trace-spool')
    const path = join(root, 'events.jsonl')
    enAttente.set(path, [...lignesEnAttente(path), line])
    planifierEcriture(root, path)
    if (redacted.id && redacted.turnId) {
      latestTraceIds.set(
        correlationKey(base, redacted.conversationId, redacted.turnId),
        redacted.id
      )
    }
    return redacted
  } catch (erreur) {
    // Le tracage ne doit JAMAIS casser l'action tracee — mais sa perte est desormais COMPTEE, et
    // lisible par `brainTraceSpoolHealth()` : une chronologie Observatory trouee ne peut plus se
    // presenter comme complete. Une ecriture refusee par le disque est comptee plus tard, dans
    // `planifierEcriture` : la trace rendue ici est deposee, pas encore posee.
    compterPerte(1, erreur)
    return undefined
  }
}

/** Identité de la récupération la plus récente émise dans ce tour, au moment d'un appel provider. */
export function latestBrainTraceId(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): string | undefined {
  return latestTraceIds.get(correlationKey(base, conversationId, turnId))
}

function readFileTraces(path: string): BrainTrace[] {
  const surDisque = existsSync(path) ? readFileSync(path, 'utf8') : ''
  // Les lignes en route qui ne sont pas déjà sur le disque (fenêtre de fin d'écriture).
  const memoire = lignesEnAttente(path).filter((ligne) => !surDisque.includes(ligne))
  if (!surDisque && memoire.length === 0) return []
  const out: BrainTrace[] = []
  for (const line of [...surDisque.split(/\r?\n/), ...memoire]) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as BrainTrace)
    } catch {
      // ligne partielle → ignorée
    }
  }
  return out
}

/** Lit les traces Brain (optionnellement filtrées par conversation), les plus récentes d'abord. */
export function readBrainTraces(
  conversationId?: string,
  base = ensureAutowinAppData()
): BrainTrace[] {
  const root = brainSpoolRoot(base)
  const all = [
    // L'archive est un anneau de deux générations : la plus ancienne (`.1`) d'abord.
    ...readFileTraces(join(root, 'events.archive.1.jsonl')),
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  // Une ligne posée deux fois à la fermeture (`flushBrainTraces`) n'est rendue qu'une fois.
  const vus = new Set<string>()
  const uniques = all.filter((t) => !t.id || (!vus.has(t.id) && Boolean(vus.add(t.id))))
  const scoped =
    conversationId === undefined
      ? uniques
      : uniques.filter((t) => t.conversationId === conversationId)
  return scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
