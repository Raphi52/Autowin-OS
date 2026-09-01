/**
 * JOURNAL D'ACTIVITÉ DES MODÈLES — modèle pur, hors composant.
 *
 * Le fil de conversation montre la RÉPONSE ; il n'a jamais montré, pour lui-même, la SUITE des
 * gestes du modèle (appel, raisonnement, commande, verdict, artefact, usage). Ces gestes existent
 * déjà à deux endroits, et aucun des deux ne suffit seul :
 *  - le journal fichier du tour (`runs:turnJournal`) : le plus riche (raisonnement, prompt-call,
 *    usage) mais nettoyé au bout de 7 jours (`turn-journal.ts`) ;
 *  - les parts persistées du message (`action` / `artifact` / `error` / `text`) : durables, mais
 *    sans le détail hors-réponse.
 * On les FUSIONNE ici, par tour : journal s'il est encore là, parts sinon. Une ligne par geste.
 */
import type { Msg } from './chat-view-types'

export type ModelActivityKind =
  'prompt' | 'model-call' | 'reasoning' | 'text' | 'action' | 'artifact' | 'error' | 'done'

export interface ModelActivityEntry {
  id: string
  turnId: string
  kind: ModelActivityKind
  label: string
  detail?: string
  ok?: boolean
  /** Heure d'écriture du geste, telle que le journal l'a inscrite (`at`). Absente hors journal. */
  at?: number
}

export interface ModelActivityInput {
  messages: readonly Msg[]
  /** Événements bruts du journal fichier, par `turnId`. Absent = tour hors rétention. */
  journalByTurn: Record<string, ReadonlyArray<Record<string, unknown>>>
}

const DETAIL_MAX = 400

/** L'heure vient du JOURNAL (`at: Date.now()` côté main) ; on ne l'INVENTE jamais quand elle manque. */
function stamp(source: Record<string, unknown>): { at?: number } {
  return typeof source.at === 'number' ? { at: source.at } : {}
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function short(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = typeof value === 'string' ? value : safeJson(value)
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat
}

/** Gestes d'un tour reconstruits depuis ses PARTS persistées (source durable). */
function fromParts(
  turnId: string,
  parts: ReadonlyArray<Record<string, unknown>>
): ModelActivityEntry[] {
  const out: ModelActivityEntry[] = []
  parts.forEach((part, index) => {
    const id = `${turnId}:part:${index}`
    if (part.kind === 'text') {
      const detail = short(part.text)
      if (detail) out.push({ id, turnId, kind: 'text', label: 'Réponse', detail, ...stamp(part) })
      return
    }
    if (part.kind === 'action') {
      const detail = short(part.args)
      out.push({
        id,
        turnId,
        kind: 'action',
        label: String(part.name ?? 'action'),
        ...stamp(part),
        ...(detail ? { detail } : {}),
        ...(typeof part.ok === 'boolean' ? { ok: part.ok } : {})
      })
      return
    }
    if (part.kind === 'artifact') {
      const artifact = (part.artifact ?? {}) as Record<string, unknown>
      const detail = short(artifact.kind)
      out.push({
        id,
        turnId,
        kind: 'artifact',
        label: String(artifact.name ?? artifact.id ?? 'artefact'),
        ...stamp(part),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (part.kind === 'error') {
      const detail = short(part.message)
      out.push({
        id,
        turnId,
        kind: 'error',
        label: `Erreur (${String(part.cause ?? 'turn')})`,
        ...stamp(part),
        ...(detail ? { detail } : {}),
        ok: false
      })
    }
  })
  return out
}

/** Gestes d'un tour reconstruits depuis son JOURNAL fichier (source la plus complète). */
function fromJournal(
  turnId: string,
  events: ReadonlyArray<Record<string, unknown>>
): ModelActivityEntry[] {
  const out: ModelActivityEntry[] = []
  const actionIndex = new Map<string, number>()
  let reasoning = ''
  let reasoningAt: { at?: number } = {}
  let text = ''
  let textAt: { at?: number } = {}
  events.forEach((event, index) => {
    const id = `${turnId}:journal:${index}`
    const kind = String(event.kind ?? '')
    if (kind === 'reasoning' || kind === 'think') {
      if (!reasoning) reasoningAt = stamp(event)
      reasoning += String(event.text ?? '')
      return
    }
    if (kind === 'delta') {
      if (!text) textAt = stamp(event)
      text += String(event.text ?? '')
      return
    }
    if (kind === 'prompt-call') {
      const detail = short(event.args)
      out.push({
        id,
        turnId,
        kind: 'model-call',
        label: `Appel modèle${event.name ? ` — ${String(event.name)}` : ''}`,
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'command') {
      const key = String(event.actionId ?? `${String(event.name ?? '')}:${index}`)
      actionIndex.set(key, out.length)
      const detail = short(event.args)
      out.push({
        id,
        turnId,
        kind: 'action',
        label: String(event.name ?? 'action'),
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'result') {
      const key = String(event.actionId ?? '')
      const position = actionIndex.get(key)
      const ok = typeof event.ok === 'boolean' ? event.ok : undefined
      const detail = short(event.data)
      if (position !== undefined) {
        const target = out[position]
        out[position] = {
          ...target,
          ...(ok === undefined ? {} : { ok }),
          ...(detail ? { detail } : {})
        }
        return
      }
      out.push({
        id,
        turnId,
        kind: 'action',
        label: String(event.name ?? 'résultat'),
        ...stamp(event),
        ...(detail ? { detail } : {}),
        ...(ok === undefined ? {} : { ok })
      })
      return
    }
    if (kind === 'error') {
      const detail = short(event.text)
      out.push({
        id,
        turnId,
        kind: 'error',
        label: 'Erreur',
        ...stamp(event),
        ...(detail ? { detail } : {}),
        ok: false
      })
      return
    }
    if (kind === 'artifact') {
      const artifact = (event.artifact ?? {}) as Record<string, unknown>
      out.push({
        id,
        turnId,
        kind: 'artifact',
        label: String(artifact.name ?? artifact.id ?? 'artefact'),
        ...stamp(event)
      })
      return
    }
    if (kind === 'done') {
      const usage = event.usage as Record<string, unknown> | undefined
      const detail = [
        event.outcome ? `issue ${String(event.outcome)}` : undefined,
        usage ? short(usage) : undefined
      ]
        .filter(Boolean)
        .join(' · ')
      out.push({
        id,
        turnId,
        kind: 'done',
        label: 'Tour terminé',
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
    }
  })
  const head: ModelActivityEntry[] = []
  if (reasoning.trim())
    head.push({
      id: `${turnId}:reasoning`,
      turnId,
      kind: 'reasoning',
      label: 'Raisonnement',
      ...reasoningAt,
      detail: short(reasoning)
    })
  const tail: ModelActivityEntry[] = []
  if (text.trim())
    tail.push({
      id: `${turnId}:delta`,
      turnId,
      kind: 'text',
      label: 'Réponse',
      ...textAt,
      detail: short(text)
    })
  // Le raisonnement PRÉCÈDE les gestes, la réponse produite les SUIT : c'est l'ordre réel du tour.
  return [...head, ...out, ...tail]
}

/**
 * Construit le journal affichable. L'ORDRE est celui du fil (donc chronologique), et un tour dont
 * le journal fichier a été nettoyé reste présent via ses parts durables.
 */
export function buildModelActivityLog(input: ModelActivityInput): ModelActivityEntry[] {
  const entries: ModelActivityEntry[] = []
  input.messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      const detail = short((message as { content?: string }).content)
      entries.push({
        id: `user:${messageIndex}`,
        turnId: '',
        kind: 'prompt',
        label: 'Demande',
        ...(detail ? { detail } : {})
      })
      return
    }
    const turnId = (message as { turnId?: string }).turnId ?? `message-${messageIndex}`
    const journal = input.journalByTurn[turnId]
    const parts = ((message as { parts?: unknown[] }).parts ?? []) as Array<Record<string, unknown>>
    entries.push(
      ...(journal && journal.length > 0 ? fromJournal(turnId, journal) : fromParts(turnId, parts))
    )
  })
  return entries
}
