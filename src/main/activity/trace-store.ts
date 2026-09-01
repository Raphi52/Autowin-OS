import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'

export type TraceEventSink = (event: TraceEventV1) => void

let installedTraceEventSink: TraceEventSink | undefined
// Tous les producteurs de trace d'Autowin vivent dans le meme main Electron. Ce registre partage
// l'allocation entre instances de TraceStore ; le journal disque reste l'autorite au redemarrage.
const allocatedSequences = new Map<string, number>()
const sequenceLockWaitBuffer = new Int32Array(new SharedArrayBuffer(4))
const SEQUENCE_LOCK_TIMEOUT_MS = 2_000
/*
 * DUREE AU-DELA DE LAQUELLE UN VERROU EST TENU POUR MORT.
 *
 * Etait 30 000 ms. Or la section critique protegee ici est une lecture puis une ecriture d'un
 * compteur de quelques octets : elle dure des MICROsecondes, et son acquisition a de toute facon un
 * budget de SEQUENCE_LOCK_TIMEOUT_MS. Un verrou encore present apres un budget entier d'acquisition
 * n'est donc pas « detenu » : son proprietaire est mort (processus tue, run interrompu) et le
 * fichier est un cadavre. Les 30 s d'origine faisaient payer ce cadavre au thread MAIN, qui attend
 * ici par Atomics.wait — mesure du 2026-08-31 (gels.jsonl) : sept gels de 25 a 44 s, tous classes
 * 'entree-sortie-bloquante' avec operation 'inconnu', c'est-a-dire boucle d'evenements tenue sans
 * consommer de CPU : la signature exacte de cette attente. Le seuil doit en outre rester STRICTEMENT SOUS le budget
 * d'acquisition : a egalite, le cadavre n'est reclame qu'a l'instant ou le budget expire, donc
 * l'appel jette au lieu d'aboutir. 500 ms laisse trois ordres de grandeur de marge sur une section
 * critique qui dure des microsecondes.
 */
const STALE_SEQUENCE_LOCK_MS = 500

/** Descripteurs de trace gardes ouverts simultanement — voir descripteurOuvert(). */
const DESCRIPTEURS_MAX = 32

/**
 * NOMME l'attente, pour que le detecteur de gel cesse de rendre 'inconnu'.
 *
 * instrumenterEntreesSortiesDuMain (src/main/gel-main.ts) ne patche que node:fs et
 * node:child_process : Atomics.wait lui est invisible. Sans cette declaration, le plus gros gel du
 * journal reste anonyme — l'instrument prouve le gel sans jamais nommer le coupable. La liaison est
 * best-effort et sans import : la trace ne doit jamais dependre du detecteur.
 */
function declarerAttenteVerrou(): () => void {
  try {
    const gel = (globalThis as { __autowinGel__?: { ouvrirOperation?: (n: string) => () => void } })
      .__autowinGel__
    return gel?.ouvrirOperation?.('trace:attente-verrou-sequence') ?? ((): void => {})
  } catch {
    return (): void => {}
  }
}

function withSequenceLock<T>(root: string, conversationId: string, action: () => T): T {
  mkdirSync(root, { recursive: true })
  const lockPath = join(root, `.${conversationId}.sequence.lock`)
  const deadline = Date.now() + SEQUENCE_LOCK_TIMEOUT_MS
  let descriptor: number | undefined
  let fermerDeclaration: (() => void) | undefined
  try {
    while (descriptor === undefined) {
      try {
        descriptor = openSync(lockPath, 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        fermerDeclaration ??= declarerAttenteVerrou()
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > STALE_SEQUENCE_LOCK_MS) {
            rmSync(lockPath, { force: true })
            continue
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw statError
        }
        if (Date.now() >= deadline)
          throw new Error('allocation de sequence verrouillee trop longtemps')
        Atomics.wait(sequenceLockWaitBuffer, 0, 0, 2)
      }
    }
  } finally {
    fermerDeclaration?.()
  }
  try {
    return action()
  } finally {
    closeSync(descriptor)
    rmSync(lockPath, { force: true })
  }
}

/** Installe une sortie best-effort globale pour les vues dérivées/exporteurs, jamais pour la durabilité. */
export function installTraceEventSink(sink: TraceEventSink): () => void {
  const previous = installedTraceEventSink
  installedTraceEventSink = sink
  return () => {
    if (installedTraceEventSink === sink) installedTraceEventSink = previous
  }
}

export class TraceStore {
  private readonly ids = new Map<string, Set<string>>()
  private readonly descriptors = new Map<string, number>()
  private readonly lastSequences = new Map<string, number>()
  private readonly sequenceCursors = new Map<
    string,
    { offset: number; mtimeMs: number; lastSequence: number }
  >()
  private scannedSequenceBytes = 0
  private readonly readCursorsStrict = new Map<
    string,
    { offset: number; mtimeMs: number; ligne: number; events: TraceEventV1[] }
  >()
  private readonly readCursorsVue = new Map<
    string,
    { offset: number; mtimeMs: number; ligne: number; events: TraceEventV1[] }
  >()
  private scannedReadBytes = 0

  constructor(private readonly root: string) {}

  private path(conversationId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('conversationId invalide')
    return join(this.root, `${conversationId}.jsonl`)
  }

  private sequenceKey(conversationId: string): string {
    return `${resolve(this.root)}\0${conversationId}`
  }

  private reserveSequence(conversationId: string, candidate: number): number {
    const key = this.sequenceKey(conversationId)
    const counterPath = join(this.root, `.${conversationId}.sequence`)
    return withSequenceLock(this.root, conversationId, () => {
      let persisted = -1
      if (existsSync(counterPath)) {
        const parsed = Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10)
        if (Number.isSafeInteger(parsed) && parsed >= 0) persisted = parsed
      }
      const sequence = Math.max(candidate, persisted + 1, (allocatedSequences.get(key) ?? -1) + 1)
      writeFileSync(counterPath, String(sequence), 'utf8')
      allocatedSequences.set(key, sequence)
      return sequence
    })
  }

  /**
   * Le descripteur d'ecriture de la conversation, avec un cache BORNE.
   *
   * Defaut : le cache etait non borne et rien ne refermait jamais un descripteur hors
   * `deleteConversation`. Une session longue qui trace beaucoup de conversations (1 472 fichiers
   * dans le dossier d'activite sur l'installation de l'utilisateur) gardait donc autant de handles
   * ouverts — jusqu'a la limite de l'OS, qui se manifeste par un EMFILE tardif et sans rapport
   * apparent avec la trace. Une trace est un flux d'APPENDS : seules les dernieres conversations
   * ecrivent, le cache n'a aucune raison de croitre sans fin. Le plus ancien descripteur est referme
   * quand la borne est franchie ; le rouvrir plus tard ne coute qu'un `openSync`.
   */
  private descripteurOuvert(conversationId: string): number {
    const existant = this.descriptors.get(conversationId)
    if (existant !== undefined) {
      // Re-insere pour marquer l'usage recent : Map preserve l'ordre d'insertion.
      this.descriptors.delete(conversationId)
      this.descriptors.set(conversationId, existant)
      return existant
    }
    const descriptor = openSync(this.path(conversationId), 'a')
    this.descriptors.set(conversationId, descriptor)
    while (this.descriptors.size > DESCRIPTEURS_MAX) {
      const [plusAncien, handle] = this.descriptors.entries().next().value as [string, number]
      this.descriptors.delete(plusAncien)
      try {
        closeSync(handle)
      } catch {
        // Un descripteur deja ferme (ou un fichier disparu) ne doit pas faire echouer une ecriture.
      }
    }
    return descriptor
  }

  append(event: TraceEventV1): this {
    assertTraceEvent(event)
    const existing = this.ids.has(event.conversationId)
      ? undefined
      : this.readConversation(event.conversationId)
    const seen = this.ids.get(event.conversationId) ?? new Set(existing!.map((x) => x.id))
    if (seen.has(event.id)) throw new Error(`événement dupliqué: ${event.id}`)
    const lastSequence =
      this.lastSequences.get(event.conversationId) ??
      (existing?.length ? existing[existing.length - 1].sequence : -1)
    if (event.sequence <= lastSequence)
      throw new Error(`sequence non monotone: ${event.sequence} <= ${lastSequence}`)
    if (event.parentId && !seen.has(event.parentId))
      throw new Error(`parent causal introuvable: ${event.parentId}`)
    mkdirSync(this.root, { recursive: true })
    const descriptor = this.descripteurOuvert(event.conversationId)
    writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, 'utf8')
    seen.add(event.id)
    this.ids.set(event.conversationId, seen)
    this.lastSequences.set(event.conversationId, event.sequence)
    const allocationKey = this.sequenceKey(event.conversationId)
    allocatedSequences.set(
      allocationKey,
      Math.max(allocatedSequences.get(allocationKey) ?? -1, event.sequence)
    )
    try {
      installedTraceEventSink?.(structuredClone(event))
    } catch {
      // Une projection ou une télémétrie optionnelle ne devient jamais une dépendance du run.
    }
    return this
  }

  /*
   * RELECTURE INCREMENTALE — correction du gel « entree-sortie-bloquante » qui GRANDIT.
   *
   * Chaque appel relisait et reparsait le fichier ENTIER, de facon synchrone, sur le thread qui
   * tient la fenetre. Sur conv-54.jsonl (5,6 Mo) un appel coute ~128 ms a froid ; il y en a
   * plusieurs par tour, d'ou une duree de gel proportionnelle a la taille du journal (1,4 s le
   * matin, 4,4 s a 13h43 dans gels.jsonl). Une trace est un flux d'APPENDS : seuls les octets
   * ajoutes depuis la derniere lecture ont besoin d'etre parses. Le fichier reste l'autorite —
   * fichier disparu, raccourci ou reecrit a taille egale = relecture complete.
   */
  private lireIncremental(conversationId: string, strict: boolean): TraceEventV1[] {
    const cache = strict ? this.readCursorsStrict : this.readCursorsVue
    const path = this.path(conversationId)
    if (!existsSync(path)) {
      cache.delete(conversationId)
      return []
    }
    const stats = statSync(path)
    const precedent = cache.get(conversationId)
    const reprise =
      precedent &&
      stats.size >= precedent.offset &&
      (stats.size > precedent.offset || stats.mtimeMs === precedent.mtimeMs)
        ? precedent
        : { offset: 0, mtimeMs: 0, ligne: 0, events: [] as TraceEventV1[] }

    if (precedent === reprise && stats.size === precedent.offset) {
      return [...precedent.events].sort((a, b) => a.sequence - b.sequence)
    }

    const suffixe = this.lireSuffixe(path, reprise.offset, stats.size)
    const completeBytes = suffixe.lastIndexOf(0x0a) + 1
    const lignesCompletes = suffixe.subarray(0, completeBytes).toString('utf8').split('\n')
    const reste = suffixe.subarray(completeBytes).toString('utf8')
    if (lignesCompletes.length && lignesCompletes[lignesCompletes.length - 1] === '')
      lignesCompletes.pop()

    const events = [...reprise.events]
    let offset = reprise.offset
    let ligne = reprise.ligne
    for (const [rang, brute] of lignesCompletes.entries()) {
      const derniereDuFichier = !reste && rang === lignesCompletes.length - 1
      const consommes = Buffer.byteLength(brute, 'utf8') + 1
      const texte = brute.endsWith('\r') ? brute.slice(0, -1) : brute
      if (!texte) {
        offset += consommes
        ligne += 1
        continue
      }
      const event = this.parseLigne(texte, conversationId, ligne + 1, strict, derniereDuFichier)
      if (event === 'tolere') break
      if (event) events.push(event)
      offset += consommes
      ligne += 1
    }
    if (reste) {
      const texte = reste.endsWith('\r') ? reste.slice(0, -1) : reste
      const event = texte ? this.parseLigne(texte, conversationId, ligne + 1, strict, true) : null
      if (event && event !== 'tolere') events.push(event)
    }

    cache.set(conversationId, { offset, mtimeMs: stats.mtimeMs, ligne, events })
    return [...events].sort((a, b) => a.sequence - b.sequence)
  }

  /** Parse une ligne ; rend `'tolere'` pour une derniere ligne tronquee, `null` pour une entree ignoree. */
  private parseLigne(
    texte: string,
    conversationId: string,
    numeroLigne: number,
    strict: boolean,
    derniereDuFichier: boolean
  ): TraceEventV1 | null | 'tolere' {
    try {
      const event = assertTraceEvent(JSON.parse(texte) as TraceEventV1)
      return event.conversationId === conversationId ? event : null
    } catch (error) {
      if (!strict) return null
      if (derniereDuFichier && error instanceof SyntaxError) return 'tolere'
      throw new Error(`trace corrompue ligne ${numeroLigne}`, { cause: error })
    }
  }

  private lireSuffixe(path: string, offset: number, size: number): Buffer {
    const longueur = Math.max(0, size - offset)
    const tampon = Buffer.allocUnsafe(longueur)
    if (longueur === 0) return tampon
    const descriptor = openSync(path, 'r')
    let lus = 0
    try {
      while (lus < longueur) {
        const read = readSync(descriptor, tampon, lus, longueur - lus, offset + lus)
        if (read === 0) break
        lus += read
      }
    } finally {
      closeSync(descriptor)
    }
    this.scannedReadBytes += lus
    return tampon.subarray(0, lus)
  }

  readConversation(conversationId: string): TraceEventV1[] {
    return this.lireIncremental(conversationId, true)
  }

  /** Lecture reservee aux vues derivees : ignore chaque entree invalide sans masquer la corruption canonique. */
  readConversationBestEffort(conversationId: string): TraceEventV1[] {
    return this.lireIncremental(conversationId, false)
  }

  nextSequence(conversationId: string): number {
    const path = this.path(conversationId)
    if (!existsSync(path)) {
      this.sequenceCursors.set(conversationId, { offset: 0, mtimeMs: 0, lastSequence: -1 })
      this.lastSequences.delete(conversationId)
      return this.reserveSequence(conversationId, 0)
    }

    const stats = statSync(path)
    const cursor = this.sequenceCursors.get(conversationId)
    if (!cursor)
      return this.reserveSequence(
        conversationId,
        this.warmSequenceCursor(conversationId, path, stats.mtimeMs)
      )

    if (stats.size === cursor.offset && stats.mtimeMs === cursor.mtimeMs) {
      return this.reserveSequence(
        conversationId,
        Math.max(cursor.lastSequence, this.lastSequences.get(conversationId) ?? -1) + 1
      )
    }
    if (stats.size < cursor.offset || stats.size === cursor.offset) {
      return this.reserveSequence(
        conversationId,
        this.warmSequenceCursor(conversationId, path, stats.mtimeMs)
      )
    }

    const suffix = Buffer.allocUnsafe(stats.size - cursor.offset)
    const descriptor = openSync(path, 'r')
    let bytesRead = 0
    try {
      while (bytesRead < suffix.length) {
        const read = readSync(
          descriptor,
          suffix,
          bytesRead,
          suffix.length - bytesRead,
          cursor.offset + bytesRead
        )
        if (read === 0) break
        bytesRead += read
      }
    } finally {
      closeSync(descriptor)
    }
    const availableSuffix = suffix.subarray(0, bytesRead)
    this.scannedSequenceBytes += bytesRead
    const completeBytes = availableSuffix.lastIndexOf(0x0a) + 1
    const lastSequence = this.scanSequenceLines(
      conversationId,
      availableSuffix.subarray(0, completeBytes),
      cursor.lastSequence
    )
    const nextCursor = {
      offset: cursor.offset + completeBytes,
      mtimeMs: stats.mtimeMs,
      lastSequence
    }
    this.sequenceCursors.set(conversationId, nextCursor)
    this.lastSequences.set(conversationId, lastSequence)
    return this.reserveSequence(conversationId, lastSequence + 1)
  }

  /** Octets réellement inspectés par les relectures de conversation, exposés pour la garde de complexité. */
  get readScanBytes(): number {
    return this.scannedReadBytes
  }

  /** Octets réellement inspectés par `nextSequence`, exposés pour la garde de complexité. */
  get sequenceScanBytes(): number {
    return this.scannedSequenceBytes
  }

  private warmSequenceCursor(conversationId: string, path: string, mtimeMs: number): number {
    const content = readFileSync(path)
    this.scannedSequenceBytes += content.length
    const completeBytes = content.lastIndexOf(0x0a) + 1
    const lastSequence = this.scanSequenceLines(
      conversationId,
      content.subarray(0, completeBytes),
      -1
    )
    this.sequenceCursors.set(conversationId, {
      offset: completeBytes,
      mtimeMs,
      lastSequence
    })
    this.lastSequences.set(conversationId, lastSequence)
    return lastSequence + 1
  }

  private scanSequenceLines(
    conversationId: string,
    content: Buffer,
    initialSequence: number
  ): number {
    let lastSequence = initialSequence
    for (const line of content.toString('utf8').split(/\r?\n/)) {
      if (!line) continue
      try {
        const event = assertTraceEvent(JSON.parse(line) as TraceEventV1)
        if (event.conversationId === conversationId) {
          lastSequence = Math.max(lastSequence, event.sequence)
        }
      } catch (error) {
        throw new Error('trace corrompue pendant allocation de sequence', { cause: error })
      }
    }
    return lastSequence
  }

  exportConversation(conversationId: string): TraceEventV1[] {
    return this.readConversation(conversationId)
  }
  importConversation(events: TraceEventV1[]): this {
    for (const event of events) this.append(event)
    return this
  }
  deleteConversation(conversationId: string): boolean {
    const path = this.path(conversationId)
    if (!existsSync(path)) return false
    const descriptor = this.descriptors.get(conversationId)
    if (descriptor !== undefined) {
      closeSync(descriptor)
      this.descriptors.delete(conversationId)
    }
    rmSync(path)
    this.ids.delete(conversationId)
    this.lastSequences.delete(conversationId)
    this.sequenceCursors.delete(conversationId)
    this.readCursorsStrict.delete(conversationId)
    this.readCursorsVue.delete(conversationId)
    allocatedSequences.delete(this.sequenceKey(conversationId))
    rmSync(join(this.root, `.${conversationId}.sequence`), { force: true })
    return true
  }
  appendRawForRecoveryTest(line: string): void {
    mkdirSync(this.root, { recursive: true })
    appendFileSync(this.path('conv-1'), line, 'utf8')
  }
}

/**
 * Resynchronise un producteur qui a pu attendre pendant qu'un run imbrique écrivait dans la même
 * conversation. La séquence proposée reste valable si aucun autre producteur ne l'a dépassée.
 */
export function rebaseTraceSequence(
  store: TraceStore,
  conversationId: string,
  proposedSequence: number
): number {
  return Math.max(proposedSequence, store.nextSequence(conversationId))
}
