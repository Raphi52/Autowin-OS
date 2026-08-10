import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { isSafeWatchdogRegex } from '../../shared/watchdog-regex'

/**
 * Lecture des lignes AJOUTEES a un fichier, par POLL de position.
 *
 * Le depot porte deja les deux approches et a deja tranche une fois : `runs/stdout-journal.ts:10`
 * documente le choix du poll CONTRE `fs.watch`, pour la robustesse au partage reseau (un `fs.watch`
 * sur un chemin UNC ne notifie pas de facon fiable, et echoue en silence — le pire mode de panne pour
 * une surveillance). Un log surveille est exactement ce cas : souvent sur un partage, souvent ecrit
 * par un autre process. On reprend donc ce precedent plutot que d'introduire une troisieme mecanique.
 *
 * L'etat tient en deux nombres par fichier, et c'est LUI qui fait que redemarrer l'application ne
 * rejoue pas l'historique comme s'il venait d'arriver.
 */
export interface FileTailState {
  /** Position de lecture atteinte (octets). */
  position: number
  /** Taille vue au dernier passage, pour detecter une troncature/rotation. */
  lastSize: number
  /** Identité du fichier : une rotation atomique peut conserver exactement la même taille. */
  fileIdentity?: string
  /** Empreinte bornée du préfixe déjà consommé, pour détecter truncate+réécriture. */
  prefixFingerprint?: string
  /** Queue textuelle déjà consommée, bornée, pour soustraire l'historique lors d'une réécriture. */
  consumedTail?: string
  /** Baseline conservée si une réécriture finit provisoirement par une ligne partielle. */
  rewriteBaselineTail?: string
}

export interface FileTailReading {
  lines: string[]
  state: FileTailState
  /** Renseigne quand le fichier est illisible : une regle muette doit pouvoir se plaindre. */
  error?: string
}

/**
 * Premier regard sur un fichier : on se positionne A LA FIN.
 *
 * Un log existant contient des milliers de lignes d'erreur passees. Les traiter comme des evenements
 * neufs au demarrage reveillerait un agent sur chacune — c'est le risque 5 du cadrage, et la raison
 * pour laquelle l'etat initial n'est pas `0`.
 */
export async function beginAtEnd(path: string): Promise<FileTailState> {
  try {
    const info = await stat(path, { bigint: true })
    const size = Number(info.size)
    return {
      position: size,
      lastSize: size,
      fileIdentity: stableFileIdentity(info),
      prefixFingerprint: await prefixFingerprint(path, size),
      consumedTail: await readConsumedTail(path, size)
    }
  } catch {
    // Fichier pas encore la : on commence a zero, ce qui est correct — tout ce qui y sera ecrit
    // ensuite EST nouveau.
    return { position: 0, lastSize: 0 }
  }
}

const MAX_CHUNK_BYTES = 1_000_000
const FINGERPRINT_EDGE_BYTES = 4_096

async function prefixFingerprint(path: string, end: number): Promise<string> {
  const hash = createHash('sha256').update(String(end), 'utf8')
  if (end <= 0) return hash.digest('hex')
  let handle
  try {
    handle = await open(path, 'r')
    const firstLength = Math.min(FINGERPRINT_EDGE_BYTES, end)
    const first = Buffer.alloc(firstLength)
    const firstRead = await handle.read(first, 0, firstLength, 0)
    hash.update(first.subarray(0, firstRead.bytesRead))
    const lastStart = Math.max(firstLength, end - FINGERPRINT_EDGE_BYTES)
    if (lastStart < end) {
      const last = Buffer.alloc(end - lastStart)
      const lastRead = await handle.read(last, 0, last.length, lastStart)
      hash.update(last.subarray(0, lastRead.bytesRead))
    }
    return hash.digest('hex')
  } finally {
    await handle?.close()
  }
}

/** Génération physique exacte, prolongeable uniquement par append du même préfixe. */
export async function captureFileGenerationMarker(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path, { bigint: true })
    const size = Number(info.size)
    return [
      'present',
      stableFileIdentity(info),
      String(size),
      String(info.mtimeNs),
      String(info.ctimeNs),
      await prefixFingerprint(path, size)
    ].join(':')
  } catch {
    return undefined
  }
}

export function captureFileGenerationMarkerSync(path: string): string | undefined {
  try {
    const info = statSync(path, { bigint: true })
    const size = Number(info.size)
    return [
      'present',
      stableFileIdentity(info),
      String(size),
      String(info.mtimeNs),
      String(info.ctimeNs),
      prefixFingerprintSync(path, size)
    ].join(':')
  } catch {
    return undefined
  }
}

function prefixFingerprintSync(path: string, end: number): string {
  const hash = createHash('sha256').update(String(end), 'utf8')
  if (end <= 0) return hash.digest('hex')
  const handle = openSync(path, 'r')
  try {
    const firstLength = Math.min(FINGERPRINT_EDGE_BYTES, end)
    const first = Buffer.alloc(firstLength)
    const firstRead = readSync(handle, first, 0, firstLength, 0)
    hash.update(first.subarray(0, firstRead))
    const lastStart = Math.max(firstLength, end - FINGERPRINT_EDGE_BYTES)
    if (lastStart < end) {
      const last = Buffer.alloc(end - lastStart)
      const lastRead = readSync(handle, last, 0, last.length, lastStart)
      hash.update(last.subarray(0, lastRead))
    }
    return hash.digest('hex')
  } finally {
    closeSync(handle)
  }
}

/**
 * Accepte la génération exacte, ou son prolongement strict par append. Une rotation, une troncature
 * ou une réécriture à taille identique ne peut donc jamais consommer une claim plus ancienne.
 */
export async function fileMatchesGenerationMarker(path: string, marker: string): Promise<boolean> {
  const [kind, expectedIdentity, sizeRaw, expectedMtime, expectedCtime, expectedPrefix] =
    marker.split(':')
  const expectedSize = Number(sizeRaw)
  if (
    kind !== 'present' ||
    !expectedIdentity ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    !expectedPrefix
  ) {
    return false
  }
  try {
    const info = await stat(path, { bigint: true })
    const size = Number(info.size)
    if (stableFileIdentity(info) !== expectedIdentity || size < expectedSize) return false
    if (size === expectedSize) {
      return String(info.mtimeNs) === expectedMtime && String(info.ctimeNs) === expectedCtime
    }
    return (await prefixFingerprint(path, expectedSize)) === expectedPrefix
  } catch {
    return false
  }
}

async function tailState(
  path: string,
  position: number,
  lastSize: number,
  fileIdentity: string,
  consumedTail?: string,
  rewriteBaselineTail?: string
): Promise<FileTailState> {
  return {
    position,
    lastSize,
    fileIdentity,
    prefixFingerprint: await prefixFingerprint(path, position),
    ...(consumedTail !== undefined ? { consumedTail } : {}),
    ...(rewriteBaselineTail !== undefined ? { rewriteBaselineTail } : {})
  }
}

export async function readNewLines(
  path: string,
  previous: FileTailState
): Promise<FileTailReading> {
  let size: number
  let fileIdentity: string
  try {
    const info = await stat(path, { bigint: true })
    size = Number(info.size)
    fileIdentity = stableFileIdentity(info)
  } catch (error) {
    return {
      lines: [],
      state: previous,
      error: `Fichier surveille illisible : ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // Fichier plus COURT qu'avant = rotation ou troncature. Garder l'ancienne position lirait des
  // octets qui appartiennent desormais a un autre contenu ; on repart du debut du nouveau fichier.
  const identityChanged = Boolean(previous.fileIdentity && previous.fileIdentity !== fileIdentity)
  let rewrittenInPlace = previous.rewriteBaselineTail !== undefined
  let position = size < previous.lastSize ? 0 : previous.position
  if (size < previous.lastSize && !identityChanged) rewrittenInPlace = true
  if (position > 0 && identityChanged) {
    position = 0
  } else if (position > 0 && previous.prefixFingerprint && position <= size) {
    const currentPrefix = await prefixFingerprint(path, position)
    if (currentPrefix !== previous.prefixFingerprint) {
      position = 0
      rewrittenInPlace = true
    }
  }
  if (position >= size) {
    return {
      lines: [],
      state: await tailState(path, size, size, fileIdentity, previous.consumedTail)
    }
  }

  // Un fichier qui explose (2 Go d'un coup) ne doit pas etre avale en entier : on lit la QUEUE, la
  // partie recente, et on saute le reste plutot que de saturer la memoire.
  if (size - position > MAX_CHUNK_BYTES) position = size - MAX_CHUNK_BYTES

  let handle
  try {
    handle = await open(path, 'r')
    const length = size - position
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    const text = buffer.subarray(0, bytesRead).toString('utf8')

    // Une derniere ligne sans saut de ligne est peut-etre en cours d'ecriture : on ne la consomme
    // pas, on laisse la position avant elle pour la relire complete au prochain passage.
    const lastBreak = text.lastIndexOf('\n')
    if (lastBreak < 0) {
      return {
        lines: [],
        state: await tailState(
          path,
          position,
          size,
          fileIdentity,
          previous.consumedTail,
          rewrittenInPlace
            ? (previous.rewriteBaselineTail ?? previous.consumedTail ?? '')
            : undefined
        )
      }
    }

    const completeWithBreak = text.slice(0, lastBreak + 1)
    const consumed = Buffer.byteLength(completeWithBreak, 'utf8')
    // Garder le séparateur pendant le split est essentiel sous Windows : retirer `\n` avant le
    // split laissait le dernier `\r` dans la ligne et cassait son empreinte causale exacte.
    const readLines = completeWithBreak.split(/\r?\n/).filter((line) => line.length > 0)
    const baseline = previous.rewriteBaselineTail ?? previous.consumedTail ?? ''
    const lines = rewrittenInPlace
      ? addedLineOccurrences(completeLines(baseline), readLines)
      : readLines
    const nextTail = boundedTail(
      position === 0 ? completeWithBreak : `${previous.consumedTail ?? ''}${completeWithBreak}`
    )
    return {
      lines,
      state: await tailState(path, position + consumed, size, fileIdentity, nextTail)
    }
  } catch (error) {
    return {
      lines: [],
      state: previous,
      error: `Lecture du fichier surveille impossible : ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    await handle?.close()
  }
}

async function readConsumedTail(path: string, end: number): Promise<string> {
  if (end <= 0) return ''
  let handle
  try {
    handle = await open(path, 'r')
    const start = Math.max(0, end - MAX_CHUNK_BYTES)
    const buffer = Buffer.alloc(end - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    if (start > 0) {
      const firstBreak = text.indexOf('\n')
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : ''
    }
    return boundedTail(text)
  } finally {
    await handle?.close()
  }
}

function boundedTail(text: string): string {
  return text.length > MAX_CHUNK_BYTES ? text.slice(-MAX_CHUNK_BYTES) : text
}

function completeLines(text: string): string[] {
  const lastBreak = text.lastIndexOf('\n')
  if (lastBreak < 0) return []
  return text
    .slice(0, lastBreak + 1)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
}

function addedLineOccurrences(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const line of before) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  return after.filter((line) => {
    const count = remaining.get(line) ?? 0
    if (count === 0) return true
    if (count === 1) remaining.delete(line)
    else remaining.set(line, count - 1)
    return false
  })
}

function stableFileIdentity(info: { dev: bigint; ino: bigint; birthtimeNs: bigint }): string {
  return process.platform === 'win32'
    ? `${info.dev},birth-${info.birthtimeNs}`
    : `${info.dev},ino-${info.ino}`
}

/**
 * Compile la condition d'une regle. Une expression invalide n'est PAS silencieusement ignoree :
 * elle retombe sur une recherche de sous-chaine, ce que l'utilisateur voulait dire neuf fois sur dix
 * en tapant `ERROR`, plutot que de ne jamais rien declencher.
 */
export function compileMatcher(pattern: string, caseSensitive = false): (line: string) => boolean {
  const flags = caseSensitive ? '' : 'i'
  if (isSafeWatchdogRegex(pattern)) {
    const expression = new RegExp(pattern, flags)
    return (line) => expression.test(line.slice(0, 8_192))
  }
  const needle = caseSensitive ? pattern : pattern.toLowerCase()
  return (line) =>
    (caseSensitive ? line.slice(0, 8_192) : line.slice(0, 8_192).toLowerCase()).includes(needle)
}
