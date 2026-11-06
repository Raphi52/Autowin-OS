import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { appendFile, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureAutowinAppData } from '../app/app-data'
import type { ExecutionEvidence } from '../providers/types'

const SPOOL_MAX_BYTES = 4 * 1024 * 1024

/*
 * ÉCRIRE UNE TRACE SANS TENIR LA FENÊTRE — /gel, 2026-10-23.
 *
 * `gels.jsonl`, le 23/10 de 09:44:09 à 09:44:57 UTC : quatre `appendFileSync` de `events.jsonl`, une
 * ligne de quelques Ko chacune, ont figé la fenêtre 8,2 s, 10,0 s, 9,8 s puis 7,6 s sur un disque
 * saturé. Ils suivent chaque écriture d'un outil du chat (`trace-workspace-mutation.ts`).
 *
 * Même remède que le journal de tour et les appels modèle (`runs/turn-journal.ts`,
 * `prompt-observability.ts`) : la ligne part sur le pool d'E/S de Node, une seule écriture en route
 * par journal pour garder l'ORDRE, et les lignes pas encore posées restent LISIBLES en mémoire
 * (`enAttente`) : tous les lecteurs de ce module les recollent, le contrôle des doublons compris.
 *
 * Reste SYNCHRONE : la rotation au-delà de 4 Mo (une fois tous les 4 Mo, et atomique pour les
 * lecteurs, qui lisent les trois fichiers) et l'arrêt de l'app (`flushConversationFileTraces`, dans
 * `before-quit`). Prix assumé : une mort BRUTALE du processus perd les traces pas encore posées.
 * Garde : `conversation-file-trace-spool.sans-gel.test.ts`.
 */
const enAttente = new Map<string, string[]>()
const ecritures = new Map<string, Promise<void>>()

function lignesEnAttente(journal: string): string[] {
  return enAttente.get(journal) ?? []
}

/** Le disque, puis les lignes en route qui n'y sont pas déjà (fenêtre de fin d'écriture). */
function avecLignesEnAttente(journal: string, surDisque: string): string {
  const memoire = lignesEnAttente(journal).filter((ligne) => !surDisque.includes(ligne))
  if (memoire.length === 0) return surDisque
  const separateur = surDisque && !surDisque.endsWith('\n') ? '\n' : ''
  return `${surDisque}${separateur}${memoire.join('')}`
}

function tournerLeJournal(root: string, journal: string): void {
  const previous = join(root, 'events.previous.jsonl')
  if (existsSync(previous)) {
    appendFileSync(join(root, 'events.archive.jsonl'), readFileSync(previous))
    rmSync(previous, { force: true })
  }
  renameSync(journal, previous)
}

function planifierEcriture(root: string, journal: string): void {
  // Une écriture déjà en route reprendra, à sa fin, les lignes arrivées entre-temps.
  if (ecritures.has(journal)) return
  const lot = [...lignesEnAttente(journal)]
  if (lot.length === 0) return
  let posees = false
  const ecriture = (async () => {
    try {
      const taille = await stat(journal).then(
        (infos) => infos.size,
        () => 0
      )
      if (taille > SPOOL_MAX_BYTES) tournerLeJournal(root, journal)
      await appendFile(journal, lot.join(''), 'utf8')
      posees = true
      const reste = lignesEnAttente(journal).slice(lot.length)
      if (reste.length === 0) enAttente.delete(journal)
      else enAttente.set(journal, reste)
    } catch {
      // Disque refusé : les lignes RESTENT en attente — relisibles, reprises par la prochaine trace
      // ou par l'arrêt de l'app. Jamais perdues en silence, jamais réessayées en boucle.
    }
  })().finally(() => {
    ecritures.delete(journal)
    if (posees) planifierEcriture(root, journal)
  })
  ecritures.set(journal, ecriture)
}

/**
 * Pose sur le disque, en BLOQUANT, les traces pas encore posées — réservé à l'arrêt de l'app.
 * Une ligne dont l'écriture était déjà en route peut alors être posée deux fois : un doublon,
 * préféré à une trace perdue (même choix que `flushAllPromptCalls`).
 */
export function flushConversationFileTraces(): void {
  for (const [journal, lignes] of [...enAttente.entries()]) {
    enAttente.delete(journal)
    if (lignes.length === 0) continue
    try {
      appendFileSync(journal, lignes.join(''), 'utf8')
    } catch {
      // Arrêt en cours : une trace perdue ne doit pas empêcher la fermeture.
    }
  }
}

/** Attend que les traces en route soient posées. Pour les TESTS : la production n'attend jamais. */
export async function attendreEcrituresDesTraces(): Promise<void> {
  while (ecritures.size > 0) await Promise.all([...ecritures.values()])
}

export interface ConversationFileTrace {
  /** Identifiant stable d'un événement rejouable après crash. */
  eventId?: string
  timestamp: string
  conversationId: string
  turnId?: string
  workspaceRoot: string
  source: 'edit_file' | 'subagent' | 'file_command' | 'chat_tool'
  paths: string[]
  /** Empreinte du diff courant immédiatement après la mutation. */
  pathFingerprints?: Record<string, string>
  pathBaseFingerprints?: Record<string, string | null>
  pathGenerationMarkers?: Record<string, string>
  pathBaseGenerationMarkers?: Record<string, string | null>
  /** Empreintes non réversibles des lignes revendiquées par un outil d'édition, par chemin. */
  pathLineFingerprints?: Record<string, string[]>
  /**
   * Le fil a NOMMÉ ces chemins dans une commande shell d'écriture (`>`, `>>`, `tee`, `sed -i`,
   * `prettier --write`, `eslint --fix` — voir `chemins-ecrits-par-commande.ts`). Distingue un
   * fichier ÉCRIT en ligne de commande d'un fichier seulement VU changer par la comparaison
   * avant/après d'un appel au modèle.
   */
  nommeParCommande?: boolean
}

type ConversationFileTraceAppendResult = 'appended' | 'duplicate' | 'ignored' | 'failed'

function spoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'conversation-file-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function normalizedStoredPath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
}

export function workspaceTracePathKey(path: string): string {
  const normalized = normalizedStoredPath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Valeurs d'un enregistrement par chemin, rangées par clé de chemin. La PREMIÈRE entrée d'une clé
 * gagne, comme le `Object.entries(...).find(...)` qu'elle remplace. Chercher chaque chemin d'une
 * trace parmi tous ses chemins coûtait chemins² : une trace de 2 344 chemins, rejouée à chaque
 * appel, a tenu la fenêtre 30 à 58 s (gels du 06/11/2026, `readCurrentPathGenerations` à 96 % du
 * profil CPU). Garde : `conversation-file-trace-spool.sans-gel.test.ts`.
 */
function indexParChemin<T>(record: Record<string, T> | undefined): Map<string, T> {
  const index = new Map<string, T>()
  for (const [candidate, value] of Object.entries(record ?? {})) {
    const key = workspaceTracePathKey(candidate)
    if (!index.has(key)) index.set(key, value)
  }
  return index
}

/** `[[chemin, valeur]]` quand l'index a une entrée pour ce chemin, même `null` ; `[]` sinon. */
function entreeDuChemin<T>(index: Map<string, T>, path: string): [string, T][] {
  const key = workspaceTracePathKey(path)
  return index.has(key) ? [[path, index.get(key) as T]] : []
}

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function normalizeWorkspaceTracePath(path: string, workspaceRoot: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed)
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  const normalized = normalizedStoredPath(rel)
  return normalized.startsWith('.git/') || normalized === '.git' ? null : normalized
}

export function appendConversationFileTrace(
  trace: ConversationFileTrace,
  base = ensureAutowinAppData()
): ConversationFileTraceAppendResult {
  const paths = [...new Set(trace.paths.map(normalizedStoredPath).filter(Boolean))]
  if (!trace.conversationId.trim() || !trace.workspaceRoot.trim() || paths.length === 0)
    return 'ignored'
  try {
    const root = spoolRoot(base)
    const path = join(root, 'events.jsonl')
    const eventId = trace.eventId?.trim()
    if (
      eventId &&
      (resumeDesJournauxFiges(root).eventIds.has(eventId) ||
        readFileTraces(path).some((existing) => existing.eventId === eventId))
    ) {
      return 'duplicate'
    }
    const fingerprintsIndex = indexParChemin(trace.pathFingerprints)
    const baseFingerprintsIndex = indexParChemin(trace.pathBaseFingerprints)
    const generationMarkersIndex = indexParChemin(trace.pathGenerationMarkers)
    const baseGenerationMarkersIndex = indexParChemin(trace.pathBaseGenerationMarkers)
    const lineFingerprintsIndex = indexParChemin(trace.pathLineFingerprints)
    const normalizedFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = fingerprintsIndex.get(workspaceTracePathKey(path))
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const normalizedBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => entreeDuChemin(baseFingerprintsIndex, path))
    )
    const normalizedGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = generationMarkersIndex.get(workspaceTracePathKey(path))
        return marker ? [[path, marker]] : []
      })
    )
    const normalizedBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => entreeDuChemin(baseGenerationMarkersIndex, path))
    )
    const normalizedLineFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprints = lineFingerprintsIndex.get(workspaceTracePathKey(path))
        return fingerprints?.length ? [[path, fingerprints]] : []
      })
    )
    const ligne = `${JSON.stringify({
      ...trace,
      workspaceRoot: canonicalWorkspaceRoot(trace.workspaceRoot),
      paths,
      ...(Object.keys(normalizedFingerprints).length > 0
        ? { pathFingerprints: normalizedFingerprints }
        : {}),
      ...(Object.keys(normalizedBaseFingerprints).length > 0
        ? { pathBaseFingerprints: normalizedBaseFingerprints }
        : {}),
      ...(Object.keys(normalizedGenerationMarkers).length > 0
        ? { pathGenerationMarkers: normalizedGenerationMarkers }
        : {}),
      ...(Object.keys(normalizedBaseGenerationMarkers).length > 0
        ? { pathBaseGenerationMarkers: normalizedBaseGenerationMarkers }
        : {}),
      ...(Object.keys(normalizedLineFingerprints).length > 0
        ? { pathLineFingerprints: normalizedLineFingerprints }
        : {})
    })}\n`
    enAttente.set(path, [...lignesEnAttente(path), ligne])
    planifierEcriture(root, path)
    return 'appended'
  } catch {
    // L'observabilité ne doit jamais interrompre la mutation qu'elle décrit.
    return 'failed'
  }
}

export function appendExecutionEvidenceFileTrace(
  evidence: readonly ExecutionEvidence[] | undefined,
  context: {
    conversationId: string
    turnId?: string
    workspaceRoot: string
    /** Le run est vert et publié : les chemins relatifs désignent désormais la base. */
    published?: boolean
    /** Identifiant stable de la publication ; chaque preuve reçoit un suffixe déterministe. */
    eventId?: string
  },
  base = ensureAutowinAppData()
): ConversationFileTraceAppendResult {
  const hasValidatedWorkspaceDelta = evidence?.some(
    (item) => item.ok && item.kind === 'mutation' && item.type === 'workspace_delta'
  )
  let aggregate: ConversationFileTraceAppendResult = 'ignored'
  for (const [evidenceIndex, item] of (evidence ?? []).entries()) {
    if (!item.ok || item.kind !== 'mutation') continue
    if (hasValidatedWorkspaceDelta && item.type !== 'workspace_delta') continue
    const workspaceRoot = context.published
      ? context.workspaceRoot
      : (item.workspaceRoot ?? context.workspaceRoot)
    const paths = (item.paths ?? (item.path ? [item.path] : []))
      .map((path) => normalizeWorkspaceTracePath(path, workspaceRoot))
      .filter((path): path is string => Boolean(path))
    const fingerprintsIndex = indexParChemin(item.pathFingerprints)
    const baseFingerprintsIndex = indexParChemin(item.pathBaseFingerprints)
    const generationMarkersIndex = indexParChemin(item.pathGenerationMarkers)
    const baseGenerationMarkersIndex = indexParChemin(item.pathBaseGenerationMarkers)
    const writtenLinesIndex = indexParChemin(item.writtenLineFingerprintsByPath)
    const pathFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = fingerprintsIndex.get(workspaceTracePathKey(path))
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const pathBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => entreeDuChemin(baseFingerprintsIndex, path))
    )
    const pathGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = generationMarkersIndex.get(workspaceTracePathKey(path))
        return marker ? [[path, marker]] : []
      })
    )
    const pathBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => entreeDuChemin(baseGenerationMarkersIndex, path))
    )
    const pathLineFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const pathSpecific = writtenLinesIndex.get(workspaceTracePathKey(path))
        const fingerprints = pathSpecific ?? item.writtenLineFingerprints
        return fingerprints?.length ? [[path, fingerprints]] : []
      })
    )
    const result = appendConversationFileTrace(
      {
        ...(context.eventId ? { eventId: `${context.eventId}:${evidenceIndex}` } : {}),
        timestamp: new Date().toISOString(),
        conversationId: context.conversationId,
        ...(context.turnId ? { turnId: context.turnId } : {}),
        workspaceRoot,
        source: 'subagent',
        paths,
        ...(Object.keys(pathFingerprints).length > 0 ? { pathFingerprints } : {}),
        ...(Object.keys(pathBaseFingerprints).length > 0 ? { pathBaseFingerprints } : {}),
        ...(Object.keys(pathGenerationMarkers).length > 0 ? { pathGenerationMarkers } : {}),
        ...(Object.keys(pathBaseGenerationMarkers).length > 0 ? { pathBaseGenerationMarkers } : {}),
        ...(Object.keys(pathLineFingerprints).length > 0 ? { pathLineFingerprints } : {})
      },
      base
    )
    if (result === 'appended') aggregate = 'appended'
    else if (result === 'failed' && aggregate !== 'appended') aggregate = 'failed'
    else if (result === 'duplicate' && aggregate === 'ignored') aggregate = 'duplicate'
  }
  return aggregate
}

function readFileTraces(path: string): ConversationFileTrace[] {
  const contenu = avecLignesEnAttente(path, existsSync(path) ? readFileSync(path, 'utf8') : '')
  if (!contenu) return []
  const traces: ConversationFileTrace[] = []
  for (const line of contenu.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ConversationFileTrace
      if (
        typeof parsed.conversationId === 'string' &&
        Array.isArray(parsed.paths) &&
        parsed.paths.every((item) => typeof item === 'string')
      ) {
        traces.push(parsed)
      }
    } catch {
      // Une dernière ligne partielle après crash est ignorée.
    }
  }
  return traces
}

/**
 * TOUTES les traces de fichiers d'une conversation, archives comprises, dans l'ordre d'écriture.
 *
 * Le spool savait déjà répondre « quels fichiers pour CE tour » (`readConversationTurnFilePaths`),
 * mais rien ne rendait la conversation ENTIÈRE : le journal du chat ne pouvait donc pas montrer ce
 * que le travail avait réellement touché, alors que la matière était écrite depuis le début.
 */
export function readConversationFileTraces(
  conversationId: string,
  base = ensureAutowinAppData()
): ConversationFileTrace[] {
  const root = spoolRoot(base)
  const resume = resumeDesJournauxFiges(root)
  return [
    ...(resume.filsArchive.has(conversationId)
      ? readFileTraces(join(root, 'events.archive.jsonl'))
      : []),
    ...(resume.filsPrecedent.has(conversationId)
      ? readFileTraces(join(root, 'events.previous.jsonl'))
      : []),
    ...readFileTraces(join(root, 'events.jsonl'))
  ].filter((trace) => trace.conversationId === conversationId)
}

/**
 * Traces RÉCENTES, tous fils confondus : le journal courant et le précédent (4 Mo max chacun), sans
 * l'archive qui grossit sans borne. Lecture ASYNCHRONE : elle tourne à chaque fin de tour de chat,
 * dans le processus qui fait vivre la fenêtre. Sert à l'enchaînement du chat : savoir si un AUTRE fil
 * a touché un fichier pendant le tour, avant de publier ce fichier au nom du tour.
 */
export async function readRecentConversationFileTraces(
  base = ensureAutowinAppData()
): Promise<ConversationFileTrace[]> {
  const root = spoolRoot(base)
  const traces: ConversationFileTrace[] = []
  for (const name of ['events.previous.jsonl', 'events.jsonl']) {
    const journal = join(root, name)
    // Journal absent : rien sur le disque, mais peut-être des traces encore en route.
    const raw = avecLignesEnAttente(journal, await readFile(journal, 'utf8').catch(() => ''))
    if (!raw) continue
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as ConversationFileTrace
        if (
          typeof parsed.conversationId === 'string' &&
          Array.isArray(parsed.paths) &&
          parsed.paths.every((item) => typeof item === 'string')
        )
          traces.push(parsed)
      } catch {
        // Une dernière ligne partielle après crash est ignorée.
      }
    }
  }
  return traces
}

/** Chemins absolus attribués à UN tour, pour relier une mutation à sa cause sans deviner au temps. */
export function readConversationTurnFilePaths(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): string[] {
  return readConversationTurnFileMutations(conversationId, turnId, base).paths
}

interface ConversationTurnFileMutations {
  paths: string[]
  lineFingerprintsByPath: Record<string, string[]>
  generationMarkersByPath: Record<string, string>
}

/** Attribution exacte d'un tour : chemins absolus et lignes revendiquées par ses outils d'édition. */
export function readConversationTurnFileMutations(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): ConversationTurnFileMutations {
  const root = spoolRoot(base)
  const resume = resumeDesJournauxFiges(root)
  const tour = cleDeTour(conversationId, turnId)
  const traces = [
    ...(resume.toursArchive.has(tour) ? readFileTraces(join(root, 'events.archive.jsonl')) : []),
    ...(resume.toursPrecedent.has(tour) ? readFileTraces(join(root, 'events.previous.jsonl')) : []),
    ...readFileTraces(join(root, 'events.jsonl'))
  ].filter((trace) => trace.conversationId === conversationId && trace.turnId === turnId)
  const lineFingerprintsByPath: Record<string, string[]> = {}
  const generationMarkersByPath: Record<string, string> = {}
  const paths = traces.flatMap((trace) => {
    const lignesIndex = indexParChemin(trace.pathLineFingerprints)
    const marqueursIndex = indexParChemin(trace.pathGenerationMarkers)
    return trace.paths.map((path) => {
      const absolute = canonicalWorkspaceRoot(
        resolve(trace.workspaceRoot, normalizedStoredPath(path))
      )
      const fingerprints = lignesIndex.get(workspaceTracePathKey(path))
      if (fingerprints?.length) {
        lineFingerprintsByPath[absolute] = [
          ...(lineFingerprintsByPath[absolute] ?? []),
          ...fingerprints
        ]
      }
      const generationMarker = marqueursIndex.get(workspaceTracePathKey(path))
      if (generationMarker) generationMarkersByPath[absolute] = generationMarker
      return absolute
    })
  })
  return { paths: [...new Set(paths)], lineFingerprintsByPath, generationMarkersByPath }
}

interface ConversationPathOwnership {
  conversationId: string
  workspaceRoot: string
  path: string
  fingerprint?: string
  generationMarker?: string
}

/** Un fil de la génération courante d'un chemin, avec le DERNIER de ses tours qui l'a touché. */
export interface CurrentPathOwner extends ConversationPathOwnership {
  turnId?: string
  timestamp: string
  /**
   * Ce fil n'a fait que VOIR ce chemin changer (`vueParComparaison`), sans l'écrire avec un outil
   * dans cette génération. Lu par la publication auto (05/11/2026) : 18 fichiers écrits
   * par un script, vus par trois fils, renvoyaient une note `/git` à chacun.
   */
  vuSeulement?: true
}

interface PathGeneration {
  fingerprint?: string
  generationMarker?: string
  owners: Map<string, CurrentPathOwner>
  /** L'état courant a été posé par un OUTIL d'écriture, pas seulement vu par une comparaison. */
  etatEcritParUnOutil?: boolean
}

function pathGenerationKey(workspaceRoot: string, path: string): string {
  return `${canonicalWorkspaceRoot(workspaceRoot)}\0${workspaceTracePathKey(path)}`
}

/**
 * Trace qui a seulement VU ce chemin changer : la comparaison avant/après d'un tour ENTIER
 * (`agent-pilot.ts`, `etatAvantEnvoi`), seule trace `chat_tool` qui ne revendique ni lignes écrites
 * ni commande d'écriture. Même partage que `chat-turn-publication.ts` (`ecritsParUnAutreFil`).
 */
function vueParComparaison(
  trace: ConversationFileTrace,
  lignesIndex: Map<string, string[]>,
  path: string
): boolean {
  if (trace.source !== 'chat_tool' || trace.nommeParCommande) return false
  const lignes = lignesIndex.get(workspaceTracePathKey(path))
  return !lignes?.length
}

/*
 * NE RELIRE QUE LE JOURNAL COURANT. L'archive (46 Mo au 06/11/2026) et le journal précédent ne
 * changent qu'à la rotation, une fois tous les 4 Mo. Ils étaient relus et rejoués à chaque appel,
 * dans le processus qui fait vivre la fenêtre : à chaque `proprietaire_fichier`, à chaque trace
 * ajoutée (contrôle des doublons), trois fois par fin de tour. Leur résumé est gardé tant que leur
 * taille et leurs dates n'ont pas bougé : générations après eux, identifiants d'événement, tours et
 * fils présents. Seul `events.jsonl` (4 Mo au plus) et ses lignes en route sont relus.
 */
interface ResumeDesJournauxFiges {
  signature: string
  /** Générations après l'archive puis le précédent. PARTAGÉES : jamais modifiées après coup. */
  generations: Map<string, PathGeneration>
  eventIds: Set<string>
  toursArchive: Set<string>
  toursPrecedent: Set<string>
  filsArchive: Set<string>
  filsPrecedent: Set<string>
}

const RESUMES_MAX = 8
const resumes = new Map<string, ResumeDesJournauxFiges>()

function signatureDuFichier(path: string): string {
  try {
    const infos = statSync(path)
    return `${infos.size}:${infos.mtimeMs}:${infos.ctimeMs}:${infos.ino}:${lignesEnAttente(path).length}`
  } catch {
    return `absent:${lignesEnAttente(path).length}`
  }
}

function cleDeTour(conversationId: string, turnId: string | undefined): string {
  return `${conversationId}\0${turnId ?? ''}`
}

function resumeDesJournauxFiges(root: string): ResumeDesJournauxFiges {
  const archive = join(root, 'events.archive.jsonl')
  const precedent = join(root, 'events.previous.jsonl')
  const signature = `${signatureDuFichier(archive)}|${signatureDuFichier(precedent)}`
  const connu = resumes.get(root)
  if (connu?.signature === signature) return connu
  const resume: ResumeDesJournauxFiges = {
    signature,
    generations: new Map(),
    eventIds: new Set(),
    toursArchive: new Set(),
    toursPrecedent: new Set(),
    filsArchive: new Set(),
    filsPrecedent: new Set()
  }
  for (const [journal, tours, fils] of [
    [archive, resume.toursArchive, resume.filsArchive],
    [precedent, resume.toursPrecedent, resume.filsPrecedent]
  ] as const) {
    const traces = readFileTraces(journal)
    for (const trace of traces) {
      if (trace.eventId) resume.eventIds.add(trace.eventId)
      tours.add(cleDeTour(trace.conversationId, trace.turnId))
      fils.add(trace.conversationId)
    }
    appliquerLesTraces(resume.generations, traces)
  }
  resumes.delete(root)
  resumes.set(root, resume)
  if (resumes.size > RESUMES_MAX) resumes.delete(resumes.keys().next().value as string)
  return resume
}

/**
 * Génération causale courante par workspace+chemin. Une chaîne before→after conserve tous ses
 * contributeurs ; une base absente ou différente ouvre une nouvelle génération et révoque l'ancienne.
 * Lue dans les DEUX sens : par fil (onglet Fichiers) et par chemin (`proprietaire_fichier`).
 */
function readCurrentPathGenerations(base: string): Map<string, PathGeneration> {
  const root = spoolRoot(base)
  const figees = resumeDesJournauxFiges(root).generations
  const generations = new Map(figees)
  appliquerLesTraces(generations, readFileTraces(join(root, 'events.jsonl')), figees)
  return generations
}

/**
 * Rejoue des traces, dans l'ordre, sur `generations`. Une génération encore PARTAGÉE avec
 * `partagees` (le résumé des journaux figés) est copiée avant d'être touchée.
 */
function appliquerLesTraces(
  generations: Map<string, PathGeneration>,
  traces: readonly ConversationFileTrace[],
  partagees?: ReadonlyMap<string, PathGeneration>
): void {
  for (const trace of traces) {
    if (typeof trace.workspaceRoot !== 'string') continue
    const workspaceRoot = canonicalWorkspaceRoot(trace.workspaceRoot)
    const fingerprintsIndex = indexParChemin(trace.pathFingerprints)
    const baseFingerprintsIndex = indexParChemin(trace.pathBaseFingerprints)
    const baseGenerationMarkersIndex = indexParChemin(trace.pathBaseGenerationMarkers)
    const generationMarkersIndex = indexParChemin(trace.pathGenerationMarkers)
    const lignesIndex = indexParChemin(trace.pathLineFingerprints)
    for (const path of trace.paths) {
      const normalized = normalizedStoredPath(path)
      const pathKey = workspaceTracePathKey(normalized)
      const fingerprint = fingerprintsIndex.get(pathKey)
      const aUneBase = baseFingerprintsIndex.has(pathKey)
      const aUneBaseDeGeneration = baseGenerationMarkersIndex.has(pathKey)
      const generationMarker = generationMarkersIndex.get(pathKey)
      const key = pathGenerationKey(workspaceRoot, normalized)
      let existante = generations.get(key)
      if (existante && partagees?.get(key) === existante) {
        existante = { ...existante, owners: new Map(existante.owners) }
        generations.set(key, existante)
      }
      const generation: PathGeneration = existante ?? { owners: new Map() }
      const vue = vueParComparaison(trace, lignesIndex, normalized)
      // Un fil qui a écrit avec un outil dans cette génération le reste, même revu ensuite.
      const vuSeulement = (): { vuSeulement?: true } => {
        const deja = generation.owners.get(trace.conversationId)
        return vue && (!deja || deja.vuSeulement) ? { vuSeulement: true } : {}
      }
      /*
       * fix-ok: (25/10/2026) — `src/main/app/reprise-apres-arret.ts`, écrit
       * (trace de son Write à 13:36:07 UTC), était rendu : la comparaison de fin de tour
       * (13:40:57), ouverte AVANT la création, a vu le fichier apparaître et, sa base
       * ne chaînant pas, a remplacé l'auteur. Or elle retombe sur l'état DÉJÀ enregistré, au même
       * marqueur physique — qui change à toute réécriture, même à l'identique (mtime/ctime) : rien
       * n'a été écrit depuis. Elle n'apporte donc aucun auteur. Retiré, ce garde rend
       * `proprietaire-fichier.test.ts` rouge (« garde à son auteur… »).
       */
      const memeEtat =
        generation.owners.size > 0 &&
        fingerprint !== undefined &&
        fingerprint === generation.fingerprint &&
        generationMarker !== undefined &&
        !generationMarker.startsWith('missing:') &&
        generationMarker === generation.generationMarker
      if (vue && memeEtat) {
        // Si personne ne l'a écrit avec un outil, chaque fil qui l'a vu reste un candidat.
        if (!generation.etatEcritParUnOutil) {
          generation.owners.set(trace.conversationId, {
            conversationId: trace.conversationId,
            workspaceRoot,
            path: normalized,
            fingerprint,
            generationMarker,
            ...(trace.turnId ? { turnId: trace.turnId } : {}),
            timestamp: trace.timestamp,
            ...vuSeulement()
          })
        }
        continue
      }
      if (
        !aUneBase ||
        !aUneBaseDeGeneration ||
        baseFingerprintsIndex.get(pathKey) !== generation.fingerprint ||
        baseGenerationMarkersIndex.get(pathKey) !== generation.generationMarker
      ) {
        generation.owners.clear()
      }
      generation.fingerprint = fingerprint
      generation.generationMarker = generationMarker
      generation.etatEcritParUnOutil = !vue
      generation.owners.set(trace.conversationId, {
        conversationId: trace.conversationId,
        workspaceRoot,
        path: normalized,
        ...(fingerprint ? { fingerprint } : {}),
        ...(generationMarker ? { generationMarker } : {}),
        ...(trace.turnId ? { turnId: trace.turnId } : {}),
        timestamp: trace.timestamp,
        ...vuSeulement()
      })
      generations.set(key, generation)
    }
  }
}

/** Empreinte et marqueur de la génération, qui priment sur ceux du dernier tour du fil. */
function ownerOfGeneration(generation: PathGeneration, owner: CurrentPathOwner): CurrentPathOwner {
  return {
    ...owner,
    ...(generation.fingerprint ? { fingerprint: generation.fingerprint } : {}),
    ...(generation.generationMarker ? { generationMarker: generation.generationMarker } : {})
  }
}

export function readCurrentConversationPathOwnership(
  conversationId: string,
  base = ensureAutowinAppData()
): ConversationPathOwnership[] {
  return [...readCurrentPathGenerations(base).values()].flatMap((generation) =>
    [...generation.owners.values()]
      .filter((ownership) => ownership.conversationId === conversationId)
      // Forme rendue INCHANGÉE pour l'onglet Fichiers : le tour et l'heure ne servent qu'au sens
      // « par chemin » ci-dessous.
      .map((owner): ConversationPathOwnership => {
        const {
          turnId: _turnId,
          timestamp: _timestamp,
          vuSeulement: _vuSeulement,
          ...ownership
        } = ownerOfGeneration(generation, owner)
        return ownership
      })
  )
}

/**
 * L'INVERSE de `readCurrentConversationPathOwnership` : pour chaque chemin d'un workspace, TOUS les
 * fils de sa génération courante, quel que soit le fil qui demande. Scout : l'agent
 * refaisait le réflexe 14 à la main (514 appels git dans 143 journaux) alors que cette donnée
 * existait, lue seulement par l'interface et seulement pour le fil affiché.
 * Rendu aligné sur `paths` (même ordre, une liste — vide — par chemin).
 *
 * fix-ok: `readCurrentConversationPathOwnership` filtre sur le fil qui DEMANDE, il ne
 * peut donc pas dire à conv-b que conv-a tient le fichier : ce filtre remis dans
 * proprietaire-fichier.ts donne 2 rouges sur 9 (« signale à conv-b… »). D'où la génération
 * factorisée, lue par chemin sans filtre de fil.
 */
export function readCurrentPathOwners(
  workspaceRoot: string,
  paths: readonly string[],
  base = ensureAutowinAppData()
): CurrentPathOwner[][] {
  const generations = readCurrentPathGenerations(base)
  return paths.map((path) => {
    const generation = generations.get(pathGenerationKey(workspaceRoot, normalizedStoredPath(path)))
    return generation
      ? [...generation.owners.values()].map((owner) => ownerOfGeneration(generation, owner))
      : []
  })
}
