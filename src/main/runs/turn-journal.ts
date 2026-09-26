import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { appendFile, open, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Journal de TOUR (append-only, une ligne JSON par événement) — socle de la survie niveau 2 :
 * la sortie d'un run vit dans un FICHIER, pas seulement dans un pipe mémoire. L'app peut donc
 * REJOUER au démarrage ce qui a été produit pendant qu'elle était fermée, et repérer les tours
 * restés inachevés (aucun `done`/`cancelled` écrit).
 *
 * Robustesse assumée : un crash en pleine écriture laisse une ligne tronquée → la relecture IGNORE
 * les lignes illisibles au lieu d'échouer (sinon un octet corrompu perdrait tout le tour).
 */

export interface TurnJournalEvent {
  /** Type d'événement (delta, command, result, done, cancelled…). */
  kind: string
  [key: string]: unknown
}

export interface UnfinishedTurn {
  conversationId: string
  turnId: string
  events: number
  updatedAt: number
}

/**
 * Événements qui CLÔTURENT un tour : leur présence signifie « rien à reprendre ».
 *
 * `failed` est le vocabulaire du STORE (`applyTurnEvent`), `error` celui du flux d'événements du
 * pilote. Les deux doivent figurer ici : un tour échoué dont le journal porte `failed` restait sinon
 * « inachevé » à jamais et la reprise automatique le rejouait à chaque démarrage — un tour ZOMBIE
 * (constaté en réel le 2026-07-29 sur une erreur d'API répétée).
 */
const TERMINAL_KINDS = new Set(['done', 'cancelled', 'error', 'failed'])

/**
 * FENÊTRE DE CONSERVATION UNIQUE des journaux — 7 jours.
 *
 * Elle vit ICI parce que c'est le journal de tour qui CITE les autres fichiers (il porte le lien vers
 * la sortie brute du CLI). Les sorties brutes partaient à 3 jours (`journal-gc.ts`) : du 4e au 7e jour,
 * un tour restait lisible en renvoyant vers un fichier déjà supprimé — une trace qui promet une preuve
 * disparue. Une seule durée décide donc des deux purges, et c'est la PLUS LONGUE qui gagne : la
 * supprimer plus tôt ne libérerait que quelques Mo au prix du diagnostic de la semaine écoulée.
 */
export const JOURNAL_RETENTION_MS = 7 * 24 * 3_600_000

/** Nom de fichier sûr (un id de conversation/tour ne doit jamais s'échapper du dossier). */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('identifiant de journal invalide')
  return cleaned.slice(0, 120)
}

export function turnJournalPath(root: string, conversationId: string, turnId: string): string {
  return join(root, safeSegment(conversationId), `${safeSegment(turnId)}.jsonl`)
}

/**
 * ÉCRITURE PAR LOTS — un tour de chat, ce sont ~300 deltas ; un `mkdirSync` + un `appendFileSync`
 * SYNCHRONES par delta bloquaient le process MAIN autant de fois, pendant le streaming.
 *
 * Deux économies, sans rien retirer à la durabilité :
 *  - le dossier de conversation n'est créé QU'UNE fois par tour (mémoire de ce qui a été créé) ;
 *  - les événements NON terminaux s'accumulent dans un tampon vidé par lots (`FLUSH_EVERY`), par un
 *    délai court (`FLUSH_DELAY_MS`), à la RELECTURE du même journal, et — surtout — sur TOUT chemin
 *    terminal (`done`/`error`/`cancelled`/`failed`), qui écrit tampon + événement d'un seul coup.
 *
 * Le prix assumé : un crash brutal dans la fenêtre de tampon peut perdre les derniers deltas d'un
 * tour INACHEVÉ — jamais la clôture, jamais un tour terminé. Même ordre de perte qu'un
 * `appendFileSync` non `fsync`é, et la reprise vise précisément les tours inachevés.
 */
const FLUSH_EVERY = 64
const FLUSH_DELAY_MS = 250
const ensuredDirs = new Set<string>()
const pending = new Map<string, string[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * HORS DU FIL PRINCIPAL — pourquoi l'écriture courante est ASYNCHRONE.
 *
 * Mesure du 2026-09-09 (`gels.jsonl`, 15:38:48 → 15:39:14) : TROIS `appendFileSync` de journal ont
 * bloqué 10 003, 10 007 et 10 004 ms d'affilée sur des fichiers de quelques Ko. Le volume n'y était
 * pour rien — le disque a calé, et comme l'écriture vivait sur le fil qui dessine l'interface,
 * l'app est restée figée ~26 s, jusqu'à la fermeture forcée. Un ralentissement disque ne doit pas
 * pouvoir geler l'interface : l'écriture courante part donc sur le pool d'I/O de Node.
 *
 * Ce qui reste SYNCHRONE, et pourquoi — la garantie « jamais la clôture » ne se négocie pas :
 *  - un événement TERMINAL (`done`/`error`/`cancelled`/`failed`) : un par tour, écrit quand le tour
 *    est déjà fini (aucun streaming à figer). S'il partait en asynchrone et que le process mourait
 *    avant, le tour repasserait « inachevé » et la reprise le rejouerait — un tour ZOMBIE ;
 *  - l'arrêt de l'app (`flushAllTurnJournals`, appelé dans `before-quit`, qui est synchrone).
 *
 * ORDRE et COMPLÉTUDE : une seule écriture est en vol par journal (`chaines`), et les lignes soumises
 * restent lisibles en mémoire (`enVol`) tant qu'elles ne sont pas sur le disque — `readTurnJournal`
 * recolle disque + en vol + tampon, donc une relecture ne rend jamais un tour tronqué.
 *
 * Le prix assumé, inchangé : une mort BRUTALE du process peut perdre les derniers deltas d'un tour
 * INACHEVÉ — jamais sa clôture, jamais un tour terminé.
 */
const enVol = new Map<string, string[]>()
const chaines = new Map<string, Promise<void>>()

function ensureDir(dir: string): void {
  // Un dossier effacé sous nos pieds (GC, test) doit être recréé : la mémoire n'est pas une preuve.
  if (ensuredDirs.has(dir) && existsSync(dir)) return
  mkdirSync(dir, { recursive: true })
  ensuredDirs.add(dir)
}

/** Retire le délai de vidage armé sur ce journal (rien à faire s'il n'y en a pas). */
function annulerDelai(path: string): void {
  const timer = timers.get(path)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(path)
  }
}

/** Sort le tampon du journal (rend [] s'il est vide) — le délai armé est annulé. */
function prendreTampon(path: string): string[] {
  annulerDelai(path)
  const lines = pending.get(path)
  if (!lines || lines.length === 0) return []
  pending.delete(path)
  return lines
}

function retirerEnVol(path: string, combien: number): void {
  const reste = (enVol.get(path) ?? []).slice(combien)
  if (reste.length === 0) enVol.delete(path)
  else enVol.set(path, reste)
}

/**
 * Écrit le tampon SANS bloquer le fil principal. Les lignes passent en `enVol` (donc toujours
 * relisibles) et n'en sortent qu'une fois posées sur le disque.
 */
function flushPathAsync(path: string): void {
  const lines = prendreTampon(path)
  if (lines.length === 0) return
  const payload = lines.join('')
  enVol.set(path, [...(enVol.get(path) ?? []), ...lines])
  const precedent = chaines.get(path) ?? Promise.resolve()
  const suite: Promise<void> = precedent
    .then(async () => {
      ensureDir(dirname(path))
      await appendFile(path, payload, 'utf8')
    })
    .then(
      () => {
        retirerEnVol(path, lines.length)
      },
      () => {
        // Échec d'écriture : les lignes RESTENT en `enVol` pour que la relecture du tour courant les
        // voie encore, et l'arrêt de l'app les reprendra en synchrone. Se taire, jamais perdre.
      }
    )
    .finally(() => {
      if (chaines.get(path) === suite) chaines.delete(path)
    })
  chaines.set(path, suite)
}

/** Écrit le tampon TOUT DE SUITE, en bloquant — réservé à la clôture d'un tour et à l'arrêt. */
function flushPathSync(path: string): void {
  const restant = enVol.get(path) ?? []
  const lines = [...restant, ...prendreTampon(path)]
  if (lines.length === 0) return
  enVol.delete(path)
  ensureDir(dirname(path))
  appendFileSync(path, lines.join(''), 'utf8')
}

/**
 * Vide le tampon d'un journal sur disque, en bloquant (rien à faire s'il est vide).
 * Appelé sur les chemins qui EXIGENT le disque : clôture de tour, arrêt de l'app.
 */
export function flushTurnJournal(root: string, conversationId: string, turnId: string): void {
  flushPathSync(turnJournalPath(root, conversationId, turnId))
}

/** Vide TOUS les tampons (arrêt de l'app : rien ne doit rester en mémoire). */
export function flushAllTurnJournals(): void {
  const chemins = new Set([...pending.keys(), ...enVol.keys()])
  for (const path of chemins) flushPathSync(path)
}

/**
 * Attend que les écritures en vol soient posées sur le disque.
 * Sert aux TESTS et à tout appelant qui doit constater le fichier — pas au chemin de production,
 * dont tout l'intérêt est justement de ne pas attendre.
 */
export async function attendreEcrituresJournal(): Promise<void> {
  while (chaines.size > 0) await Promise.all([...chaines.values()])
}

/**
 * Signature d'une clôture : ce qui la rend DISCERNABLE d'une autre (l'horodatage, lui, change à
 * chaque tentative et ne doit pas servir à distinguer deux fois le même refus).
 */
function signatureCloture(event: TurnJournalEvent): string {
  const { at: _at, ...reste } = event
  return JSON.stringify(reste)
}

/** Vrai si ce tour porte DÉJÀ une clôture identique (même type, même erreur). */
function clotureDejaEcrite(path: string, event: TurnJournalEvent): boolean {
  const signature = signatureCloture(event)
  const memoire = [...(enVol.get(path) ?? []), ...(pending.get(path) ?? [])].slice(0, -1)
  const surDisque = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []
  for (const ligne of [...surDisque, ...memoire]) {
    const trimmed = ligne.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as TurnJournalEvent
      if (!parsed || typeof parsed.kind !== 'string') continue
      if (!TERMINAL_KINDS.has(parsed.kind)) continue
      if (signatureCloture(parsed) === signature) return true
    } catch {
      /* ligne tronquée : elle ne prouve aucune clôture */
    }
  }
  return false
}

/** Append d'un événement (crée l'arborescence au besoin, écrit par LOTS). */
export function appendTurnEvent(
  root: string,
  conversationId: string,
  turnId: string,
  event: TurnJournalEvent
): void {
  const path = turnJournalPath(root, conversationId, turnId)
  const lines = pending.get(path) ?? []
  /*
   * HORODATAGE AU POINT DE PASSAGE UNIQUE. Les émetteurs de fin de tour (`failed`, `resumed`
   * via orchestrate-turn-persistence / run-pilot-chat) ne posent pas `at` : mesuré le 2026-09-12
   * sur 1 381 journaux, 1 036 `failed` sur 1 099 et 1 094 `resumed` sur 1 223 étaient indatables,
   * donc impossibles à replacer dans la chronologie du fil. On complète ici plutôt que chez chaque
   * appelant ; un `at` déjà fourni (tests, rejeu) est respecté tel quel.
   */
  const horodate = typeof event.at === 'number' ? event : { ...event, at: Date.now() }
  lines.push(`${JSON.stringify(horodate)}\n`)
  pending.set(path, lines)
  if (TERMINAL_KINDS.has(event.kind)) {
    // CLÔTURE IDEMPOTENTE. Le contrat en tête de ce fichier dit « un événement terminal par tour » ;
    // dans les faits un refus de reprise annoncé DÉFINITIF revenait à chaque démarrage et réécrivait
    // le MÊME `failed` (92 fois dans un seul journal, mesuré le 2026-09-12). Une clôture identique
    // déjà présente n'apporte aucune information : on la refuse au lieu de l'empiler.
    if (clotureDejaEcrite(path, horodate)) {
      pending.set(path, lines.slice(0, -1))
      if (process.env.VITEST || process.env.NODE_ENV === 'test') {
        throw new Error(
          `journal de tour : clôture « ${event.kind} » déjà écrite pour ce tour, seconde écriture refusée`
        )
      }
      return
    }
    // Clôture du tour : le disque AVANT de rendre la main, sinon le tour repasse « inachevé ».
    flushPathSync(path)
    return
  }
  if (lines.length >= FLUSH_EVERY) {
    flushPathAsync(path)
    return
  }
  if (!timers.has(path)) {
    const timer = setTimeout(() => flushPathAsync(path), FLUSH_DELAY_MS)
    timer.unref?.()
    timers.set(path, timer)
  }
}

/** Relit un journal ; ignore les lignes illisibles (tronquées par un crash). */
export function readTurnJournal(
  root: string,
  conversationId: string,
  turnId: string
): TurnJournalEvent[] {
  const path = turnJournalPath(root, conversationId, turnId)
  // Un tampon non encore vidé, et une ligne encore EN VOL vers le disque, font PARTIE du journal :
  // les omettre rendrait un tour tronqué à la reprise — le seul coût que le lotissement n'a pas le
  // droit d'avoir. On recolle donc disque + en vol + tampon, sans forcer d'écriture bloquante.
  const memoire = [...(enVol.get(path) ?? []), ...(pending.get(path) ?? [])]
  const surDisque = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (!surDisque && memoire.length === 0) return []
  const out: TurnJournalEvent[] = []
  for (const line of [...surDisque.split('\n'), ...memoire]) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as TurnJournalEvent
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') out.push(parsed)
    } catch {
      // ligne tronquée/corrompue → on saute, le reste du tour reste exploitable
    }
  }
  return out
}

/** Un tour est TERMINÉ si son journal contient un événement terminal. */
export function isTurnFinished(events: readonly TurnJournalEvent[]): boolean {
  return events.some((event) => TERMINAL_KINDS.has(event.kind))
}

/**
 * Tours restés INACHEVÉS (à rejouer/reprendre au démarrage), les plus récents d'abord.
 * Racine absente → [] (aucun journal, comportement historique).
 */
/** Taille du bloc de queue relu : un événement terminal est court, quelques Ko suffisent. */
const QUEUE_OCTETS = 8_192

/**
 * Le tour est-il TERMINÉ, sans lire tout son journal ? `undefined` = indéterminé, il faut le lire.
 *
 * Mesure du 2026-09-05 (`gels.jsonl`) : l'inventaire des tours inachevés a bloqué l'application
 * 2124 ms, dont 1730 ms dans 946 `readFileSync` — un journal ENTIER ouvert et analysé ligne à ligne
 * par tour, pour n'en retenir qu'une poignée. Or un événement terminal vide le tampon
 * IMMÉDIATEMENT (voir `TERMINAL_KINDS` dans `appendTurnEvent`) : il est donc en FIN de fichier.
 *
 * On relit ce seul bloc final. La première ligne du bloc est jetée quand elle peut être coupée par
 * la troncature de lecture — juger sur une ligne incomplète serait deviner. Et toute incertitude
 * (fichier vide, queue illisible, aucun événement exploitable) rend `undefined` : on retombe alors
 * sur la lecture complète, jamais sur une conclusion optimiste. Un tour déclaré terminé à tort ne
 * serait plus jamais repris — c'est exactement la perte que la survie niveau 2 doit empêcher.
 */
/*
 * fix-ok: 2026-09-17 18:59, `ipc:runs:unfinishedTurns` 1,48 s dont 986 `openSync` (1 218 ms) — la
 * queue de chaque journal TERMINÉ était rouverte à chaque appel. Un terminé reste terminé tant que
 * le fichier ne bouge pas : on retient ce verdict (et lui seul) avec la taille et la date vues.
 */
const termineConnus = new Map<string, { taille: number; mtimeMs: number }>()

function journalTermineParLaQueue(path: string): boolean | undefined {
  let fd: number | undefined
  try {
    const etat = statSync(path)
    const taille = etat.size
    if (taille === 0) return undefined
    const connu = termineConnus.get(path)
    if (connu && connu.taille === taille && connu.mtimeMs === etat.mtimeMs) return true
    fd = openSync(path, 'r')
    const debut = Math.max(0, taille - QUEUE_OCTETS)
    const tampon = Buffer.allocUnsafe(taille - debut)
    const lus = readSync(fd, tampon, 0, tampon.length, debut)
    const lignes = tampon.subarray(0, lus).toString('utf8').split('\n')
    // Le bloc commence au milieu du fichier : sa première ligne est peut-être coupée en deux.
    if (debut > 0) lignes.shift()
    let vuUnEvenement = false
    for (const ligne of lignes) {
      const nette = ligne.trim()
      if (!nette) continue
      try {
        const evenement = JSON.parse(nette) as TurnJournalEvent
        if (!evenement || typeof evenement.kind !== 'string') continue
        vuUnEvenement = true
        if (TERMINAL_KINDS.has(evenement.kind)) {
          termineConnus.set(path, { taille, mtimeMs: etat.mtimeMs })
          return true
        }
      } catch {
        // Ligne tronquée par un crash : la queue ne conclut plus rien de fiable.
        return undefined
      }
    }
    // Des événements lisibles jusqu'au bout, aucun terminal : le tour est bien en vol.
    return vuUnEvenement && debut === 0 ? false : undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* fermeture best-effort : un descripteur déjà clos ne doit rien casser */
      }
    }
  }
}

export function listUnfinishedTurns(root: string): UnfinishedTurn[] {
  // Un SCAN de l'arborescence décide de ce qui est inachevé ou obsolète : les tampons encore en
  // mémoire doivent être sur disque AVANT, sinon un tour en vol serait invisible (donc jamais repris).
  flushAllTurnJournals()
  if (!existsSync(root)) return []
  const found: UnfinishedTurn[] = []
  for (const conversationId of readdirSync(root)) {
    const dir = join(root, conversationId)
    let entries: string[]
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue
      const turnId = file.slice(0, -'.jsonl'.length)
      // La FIN du journal suffit presque toujours à trancher, et elle coûte un bloc au lieu du
      // fichier entier. Les tours terminés — l'immense majorité — ne sont donc plus jamais ouverts
      // en entier ; seuls les tours réellement en vol, ou les queues douteuses, sont relus.
      if (journalTermineParLaQueue(join(dir, file)) === true) continue
      const events = readTurnJournal(root, conversationId, turnId)
      if (events.length === 0 || isTurnFinished(events)) continue
      found.push({
        conversationId,
        turnId,
        events: events.length,
        updatedAt: statSync(join(dir, file)).mtimeMs
      })
    }
  }
  return found.sort((a, b) => b.updatedAt - a.updatedAt)
}

/*
 * INVENTAIRE NON BLOQUANT, pour le canal IPC de démarrage.
 *
 * fix-ok: 2026-09-17 18:59, `ipc:runs:unfinishedTurns` 1,48 s à l'ouverture dont 986 `openSync` —
 * la mémoire `termineConnus` est vide au premier appel, donc la version synchrone rouvre encore
 * chaque journal. Même logique, mêmes verdicts, mais toutes les E/S passent par `fs/promises` :
 * la fenêtre n'est plus figée pendant le parcours. Seul le vidage des tampons reste synchrone
 * (obligatoire : un tour en vol pas encore sur disque serait invisible).
 */
async function journalTermineParLaQueueAsync(path: string): Promise<boolean | undefined> {
  let fichier: Awaited<ReturnType<typeof open>> | undefined
  try {
    const etat = await stat(path)
    const taille = etat.size
    if (taille === 0) return undefined
    const connu = termineConnus.get(path)
    if (connu && connu.taille === taille && connu.mtimeMs === etat.mtimeMs) return true
    fichier = await open(path, 'r')
    const debut = Math.max(0, taille - QUEUE_OCTETS)
    const tampon = Buffer.allocUnsafe(taille - debut)
    const { bytesRead } = await fichier.read(tampon, 0, tampon.length, debut)
    const lignes = tampon.subarray(0, bytesRead).toString('utf8').split('\n')
    if (debut > 0) lignes.shift()
    let vuUnEvenement = false
    for (const ligne of lignes) {
      const nette = ligne.trim()
      if (!nette) continue
      try {
        const evenement = JSON.parse(nette) as TurnJournalEvent
        if (!evenement || typeof evenement.kind !== 'string') continue
        vuUnEvenement = true
        if (TERMINAL_KINDS.has(evenement.kind)) {
          termineConnus.set(path, { taille, mtimeMs: etat.mtimeMs })
          return true
        }
      } catch {
        return undefined
      }
    }
    return vuUnEvenement && debut === 0 ? false : undefined
  } catch {
    return undefined
  } finally {
    await fichier?.close().catch(() => undefined)
  }
}

async function readTurnJournalAsync(path: string): Promise<TurnJournalEvent[]> {
  const memoire = [...(enVol.get(path) ?? []), ...(pending.get(path) ?? [])]
  const surDisque = await readFile(path, 'utf8').catch(() => '')
  const out: TurnJournalEvent[] = []
  for (const line of [...surDisque.split('\n'), ...memoire]) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as TurnJournalEvent
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') out.push(parsed)
    } catch {
      // ligne tronquée/corrompue → on saute, comme `readTurnJournal`
    }
  }
  return out
}

/** Version non bloquante de `listUnfinishedTurns` : même résultat, aucune E/S synchrone. */
export async function listUnfinishedTurnsAsync(root: string): Promise<UnfinishedTurn[]> {
  flushAllTurnJournals()
  let conversations: string[]
  try {
    conversations = await readdir(root)
  } catch {
    return []
  }
  const found: UnfinishedTurn[] = []
  for (const conversationId of conversations) {
    const dir = join(root, conversationId)
    let entries: string[]
    try {
      if (!(await stat(dir)).isDirectory()) continue
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue
      const path = join(dir, file)
      if ((await journalTermineParLaQueueAsync(path)) === true) continue
      const events = await readTurnJournalAsync(path)
      if (events.length === 0 || isTurnFinished(events)) continue
      let updatedAt: number
      try {
        updatedAt = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      found.push({
        conversationId,
        turnId: file.slice(0, -'.jsonl'.length),
        events: events.length,
        updatedAt
      })
    }
  }
  return found.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * GC : supprime les journaux TERMINÉS plus vieux que `maxAgeMs` (défaut 7 j). Ne touche jamais un
 * tour inachevé (c'est précisément ce qu'on veut pouvoir reprendre). Renvoie le nombre supprimé.
 */
/*
 * REPRISE DU MENAGE, par racine de journaux.
 *
 * fix-ok: 25 gels « ipc:runs:unfinishedTurns (sync) » / 69 s — la cause mesuree est un scan complet
 * (462 dossiers, 1 376 fichiers, 141 Mo) execute en entier, en synchrone, a chaque ouverture. La
 * passe est desormais BORNEE ; sans curseur, une passe bornee repasserait indefiniment sur les memes
 * fichiers et ne solderait jamais l'arriere. La position est la derniere entree traitee, en ordre
 * stable ; une passe qui va au bout remet le curseur a zero.
 */
const curseursMenage = new Map<string, string>()

/** Bornes d'une passe de menage : au-dela, la passe s'arrete et reprendra la ou elle en etait. */
export interface BornesMenage {
  maxSuppressions?: number
  budgetMs?: number
}

export function pruneFinishedTurnJournals(
  root: string,
  maxAgeMs = JOURNAL_RETENTION_MS,
  now = Date.now(),
  bornes: BornesMenage = {}
): number {
  // Un SCAN de l'arborescence décide de ce qui est inachevé ou obsolète : les tampons encore en
  // mémoire doivent être sur disque AVANT, sinon un tour en vol serait invisible (donc jamais repris).
  flushAllTurnJournals()
  if (!existsSync(root)) return 0
  const maxSuppressions = bornes.maxSuppressions ?? 200
  const echeance = Date.now() + (bornes.budgetMs ?? 150)
  const cleRacine = resolve(root)
  const reprise = curseursMenage.get(cleRacine) ?? ''
  let removed = 0
  let derniereEntree = ''
  let interrompue = false
  for (const conversationId of readdirSync(root).sort()) {
    if (interrompue) break
    const dir = join(root, conversationId)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.jsonl')) continue
      const position = `${conversationId}/${file}`
      if (position <= reprise) continue
      if (removed >= maxSuppressions || Date.now() > echeance) {
        interrompue = true
        break
      }
      derniereEntree = position
      const path = join(dir, file)
      const turnId = file.slice(0, -'.jsonl'.length)
      // L'ÂGE d'abord : c'est un statSync, alors que la lecture (flush + readFileSync + JSON.parse
      // ligne à ligne) coûte tout le fichier. Un journal frais n'est JAMAIS ouvert — il ne peut de
      // toute façon pas être supprimé.
      let stale: boolean
      try {
        stale = now - statSync(path).mtimeMs > maxAgeMs
      } catch {
        continue
      }
      if (!stale) continue
      const events = readTurnJournal(root, conversationId, turnId)
      if (isTurnFinished(events)) {
        rmSync(path)
        removed += 1
      }
    }
  }
  curseursMenage.set(cleRacine, interrompue ? derniereEntree : '')
  return removed
}

/**
 * Rend les tours INACHEVES tout de suite, et ne differe QUE le menage.
 *
 * Le canal `runs:unfinishedTurns` faisait le contraire : ~2,8 s de fenetre figee par ouverture, 69 s
 * cumulees sur 25 gels. Ce qui ne se differe PAS, c'est le flush des tampons : un tour en vol pas
 * encore sur disque serait invisible, donc jamais repris. La verite rendue prime, le GC attend.
 * Le menage differe ne doit jamais jeter : hors du handler, un throw ne serait plus capture.
 */
export function listUnfinishedTurnsPuisMenage(
  root: string,
  options: {
    menage?: () => void
    planifier?: (tache: () => void) => void
  } = {}
): UnfinishedTurn[] {
  flushAllTurnJournals()
  const liste = listUnfinishedTurns(root)
  planifierMenage(root, options)
  return liste
}

/** Variante NON bloquante pour le canal IPC de démarrage (cf. `listUnfinishedTurnsAsync`). */
export async function listUnfinishedTurnsPuisMenageAsync(
  root: string,
  options: {
    menage?: () => void
    planifier?: (tache: () => void) => void
  } = {}
): Promise<UnfinishedTurn[]> {
  const liste = await listUnfinishedTurnsAsync(root)
  planifierMenage(root, options)
  return liste
}

function planifierMenage(
  root: string,
  options: { menage?: () => void; planifier?: (tache: () => void) => void }
): void {
  const menage = options.menage ?? ((): void => void pruneFinishedTurnJournals(root))
  const planifier = options.planifier ?? ((tache: () => void): void => void setImmediate(tache))
  planifier(() => {
    try {
      menage()
    } catch {
      /* GC best-effort : jamais au prix du demarrage */
    }
  })
}

/**
 * Supprime TOUS les journaux de tour d'une conversation — appelé quand la conversation elle-même
 * disparaît. Sans cela, un dossier par conversation supprimée restait indéfiniment sur le disque :
 * le GC par âge (`pruneFinishedTurnJournals`) ne descend jamais jusqu'à retirer le dossier vide,
 * et un tour INACHEVÉ d'une conversation supprimée n'aurait de toute façon plus rien à reprendre.
 */
export function removeConversationTurnJournals(root: string, conversationId: string): boolean {
  const dir = join(root, safeSegment(conversationId))
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/**
 * Tous les tours JOURNALISÉS d'une conversation, du plus ancien au plus récent.
 *
 * Ajouté pour le dossier de preuve `/kaizen` : `readTurnJournal` exige un identifiant de tour, donc
 * aucune vue dérivée ne pouvait dire « montre-moi les derniers tours de cette conversation ».
 * Lecture seule stricte : aucun fichier créé, un dossier absent rend une liste vide.
 */
export function listConversationTurnIds(root: string, conversationId: string): string[] {
  try {
    const dir = join(root, safeSegment(conversationId))
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ id: name.slice(0, -'.jsonl'.length), at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => a.at - b.at)
      .map(({ id }) => id)
  } catch {
    return []
  }
}

/** Les `maxTurns` DERNIERS tours d'une conversation, avec leurs événements. */
export function readConversationTurnJournals(
  root: string,
  conversationId: string,
  maxTurns = 3
): Array<{ turnId: string; events: TurnJournalEvent[] }> {
  return listConversationTurnIds(root, conversationId)
    .slice(-Math.max(0, maxTurns))
    .map((turnId) => ({ turnId, events: readTurnJournal(root, conversationId, turnId) }))
}
