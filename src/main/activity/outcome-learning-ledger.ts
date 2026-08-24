import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { OUTCOME_LEARNING_SCHEMA } from '../../shared/run-learning'
import type { OutcomeLearningEventV1 } from '../../shared/run-learning'

const MAX_LEDGER_BYTES = 8 * 1024 * 1024
const PROPOSAL_LOCK_LEASE_MS = 60_000
const KINDS = new Set<OutcomeLearningEventV1['kind']>([
  'proposal',
  'outcome',
  'decision',
  'curation-intent',
  'curation-resolution',
  'curation'
])

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertEvent(value: unknown): asserts value is OutcomeLearningEventV1 {
  if (!record(value) || typeof value.kind !== 'string' || !KINDS.has(value.kind as never)) {
    throw new Error('événement outcome-learning invalide')
  }
  if (!record(value.value)) throw new Error('événement outcome-learning sans valeur')
  if (value.value.schema !== OUTCOME_LEARNING_SCHEMA) {
    throw new Error(`schema outcome-learning inconnu : ${String(value.value.schema ?? 'absent')}`)
  }
  for (const field of ['eventId', 'conversationId', 'turnId'] as const) {
    if (
      ['decision', 'curation', 'curation-intent', 'curation-resolution'].includes(value.kind) &&
      field !== 'eventId'
    )
      continue
    if (typeof value.value[field] !== 'string' || !value.value[field].trim()) {
      throw new Error(`événement outcome-learning sans ${field}`)
    }
  }
}

function eventId(event: OutcomeLearningEventV1): string {
  return event.value.eventId
}

export class OutcomeLearningLedger {
  readonly path: string

  constructor(path: string) {
    this.path = resolve(path)
  }

  /**
   * Réservation interprocessus du droit de déposer la proposition d'un tour. Le verrou est pris
   * avant l'appel réseau Brain puis relu sous verrou : deux instances Autowin ne peuvent donc pas
   * créer deux candidats pour le même tour.
   */
  reserveProposalTurn(conversationId: string, turnId: string): (() => void) | undefined {
    mkdirSync(dirname(this.path), { recursive: true })
    const key = createHash('sha256').update(`${conversationId}\0${turnId}`).digest('hex')
    const lockPath = `${this.path}.${key}.proposal.lock`
    let descriptor: number | undefined
    for (let attempt = 0; attempt < 2 && descriptor === undefined; attempt += 1) {
      try {
        descriptor = openSync(lockPath, 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (attempt > 0 || !expiredProposalLock(lockPath)) return undefined
        try {
          unlinkSync(lockPath)
        } catch {
          return undefined
        }
      }
    }
    if (descriptor === undefined) return undefined
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      try {
        closeSync(descriptor)
      } finally {
        try {
          unlinkSync(lockPath)
        } catch {
          // Idempotent : le verrou peut déjà avoir été nettoyé après un arrêt contrôlé.
        }
      }
    }
    try {
      writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), conversationId, turnId })
      )
      const alreadyRecorded = this.read().events.some(
        (event) =>
          event.kind === 'proposal' &&
          event.value.conversationId === conversationId &&
          event.value.turnId === turnId
      )
      if (alreadyRecorded) {
        release()
        return undefined
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  append(event: OutcomeLearningEventV1): boolean {
    assertEvent(event)
    const current = this.read()
    if (current.truncatedTail) {
      throw new Error(
        'journal outcome-learning tronqué — réparation explicite requise avant append'
      )
    }
    if (current.events.some((item) => eventId(item) === eventId(event))) return false
    mkdirSync(dirname(this.path), { recursive: true })
    const line = `${JSON.stringify(event)}\n`
    const size = existsSync(this.path) ? statSync(this.path).size : 0
    if (size + Buffer.byteLength(line, 'utf8') > MAX_LEDGER_BYTES) {
      throw new Error(`journal outcome-learning plein (${MAX_LEDGER_BYTES} octets)`)
    }
    appendFileSync(this.path, line, { encoding: 'utf8', flush: true })
    return true
  }

  /**
   * `ecartees` = nombre de lignes refusees POUR LEUR FORME et laissees de cote.
   *
   * Ce compte est rendu, pas seulement journalise, et c'est deliberé. Sur le journal des
   * conversations, une ligne ecartee est une conversation perdue -- VISIBLE. Ici c'est un evenement
   * d'apprentissage en moins : la degradation est INVISIBLE, donc elle doit etre representable par
   * l'appelant plutot que noyee dans un `console.warn`.
   */
  read(): { events: OutcomeLearningEventV1[]; truncatedTail: boolean; ecartees: number } {
    if (!existsSync(this.path)) return { events: [], truncatedTail: false, ecartees: 0 }
    const size = statSync(this.path).size
    if (size > MAX_LEDGER_BYTES) {
      throw new Error(`journal outcome-learning trop volumineux (${size} octets)`)
    }
    const raw = readFileSync(this.path, 'utf8')
    if (!raw) return { events: [], truncatedTail: false, ecartees: 0 }
    const completeTail = raw.endsWith('\n')
    const lines = raw.split('\n')
    if (completeTail) lines.pop()
    const events: OutcomeLearningEventV1[] = []
    const ids = new Set<string>()
    let truncatedTail = false
    const ecartees: string[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.trim()) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        if (!completeTail && index === lines.length - 1) {
          truncatedTail = true
          break
        }
        throw new Error(`journal outcome-learning corrompu à la ligne ${index + 1}`)
      }
      try {
        assertEvent(parsed)
      } catch (error) {
        /*
         * UNE LIGNE REFUSEE POUR SA FORME NE CONDAMNE PAS LE REGISTRE ENTIER.
         *
         * Meme classe de defaut que celui vecu le 2026-08-24 sur le journal des conversations : un
         * seul enregistrement mal forme y avait rendu l'application inbootable, 1175 conversations
         * inaccessibles. Ici le cout est un evenement contre TOUTE la fonction d'apprentissage.
         *
         * LA COUPURE N'EST PAS UN DESSERRAGE : un JSON ILLISIBLE reste fatal juste au-dessus, parce
         * qu'on ne sait pas ce qu'il contenait. Une forme refusee, elle, est identifiee -- on sait
         * exactement quelle ligne on ecarte, on la nomme, et on la COMPTE.
         */
        ecartees.push(
          `ligne ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        )
        continue
      }
      const id = eventId(parsed)
      if (ids.has(id)) continue
      ids.add(id)
      events.push(parsed)
    }
    if (ecartees.length) {
      // BRUYANT a dessein : un evenement d'apprentissage ecarte en silence biaise l'apprentissage
      // sans temoin. Le compte rendu ci-dessous rend la degradation lisible par l'appelant.
      console.warn(
        `[outcome-learning] ${ecartees.length} ligne(s) ecartee(s) dans ${this.path} — ` +
          `le reste est charge. ${ecartees.slice(0, 5).join(' | ')}`
      )
    }
    return { events, truncatedTail, ecartees: ecartees.length }
  }
}

function expiredProposalLock(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { createdAtMs?: unknown }
    const createdAtMs =
      typeof parsed.createdAtMs === 'number' ? parsed.createdAtMs : statSync(path).mtimeMs
    return Date.now() - createdAtMs > PROPOSAL_LOCK_LEASE_MS
  } catch {
    try {
      return Date.now() - statSync(path).mtimeMs > PROPOSAL_LOCK_LEASE_MS
    } catch {
      return false
    }
  }
}
