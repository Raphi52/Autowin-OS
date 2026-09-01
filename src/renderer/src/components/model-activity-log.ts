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
 *  - la TRACE CAUSALE de la conversation (`os:causalTrace`) : ce qu'analysait l'Observatory —
 *    injections de contexte, frontières de confiance, appels d'outils, verdicts, refus ;
 *  - le journal d'ACTIVITÉ de la conversation (`conversationActivity`) : provider, modèle, tokens,
 *    coût, durée de chaque appel facturé.
 * On les UNIT ici — jamais « l'un OU l'autre » : chaque source apporte ce que les autres n'ont pas,
 * les doublons exacts sont écartés, et chaque ligne dit de quelle SOURCE elle vient. Une ligne par
 * geste, l'ensemble trié chronologiquement.
 */
import type { Msg } from './chat-view-types'

export type ModelActivityKind =
  | 'prompt'
  | 'model-call'
  | 'reasoning'
  | 'text'
  | 'action'
  | 'artifact'
  | 'error'
  | 'done'
  /** Contexte INJECTÉ dans l'appel (état de l'app, historique, ressource, pièce jointe). */
  | 'injection'
  /** Frontière de confiance franchie : d'où vient la donnée, et avec quelle fidélité. */
  | 'boundary'
  /** Appel facturé : provider, modèle, tokens, coût, durée. */
  | 'usage'
  /** Tout geste journalisé qui n'entre dans AUCUNE des catégories ci-dessus. Rien ne se perd. */
  | 'event'

/** D'où vient la ligne. Affiché et filtrable : une preuve sans provenance n'en est pas une. */
export type ModelActivitySource = 'thread' | 'journal' | 'parts' | 'causal' | 'activity'

export interface ModelActivityEntry {
  id: string
  turnId: string
  kind: ModelActivityKind
  label: string
  detail?: string
  ok?: boolean
  /** Heure d'écriture du geste, telle que le journal l'a inscrite (`at`). Absente hors journal. */
  at?: number
  /** Source d'où le geste est lu. Jamais devinée. */
  source: ModelActivitySource
}

export interface ModelActivityInput {
  messages: readonly Msg[]
  /** Événements bruts du journal fichier, par `turnId`. Absent = tour hors rétention. */
  journalByTurn: Record<string, ReadonlyArray<Record<string, unknown>>>
  /** Trace causale de la conversation (`autowin.trace/v1`), telle quelle. */
  causal?: ReadonlyArray<Record<string, unknown>>
  /** Journal d'activité facturée de la conversation (`activity/<conv>.jsonl`), tel quel. */
  activity?: ReadonlyArray<Record<string, unknown>>
}

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

/**
 * Détail d'une valeur — INTÉGRAL. Ce journal est lu À LA PLACE de l'Observatory : une troncature
 * (elle était à 400 caractères) coupait raisonnement, réponse et sortie de commande en plein milieu,
 * exactement l'information qu'on vient y chercher. On ne normalise donc que les espaces horizontaux
 * et on GARDE les sauts de ligne (le rendu est en `pre-wrap` et borne la HAUTEUR affichée : c'est une
 * limite d'affichage, jamais une perte).
 */
function short(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = typeof value === 'string' ? value : safeJson(value)
  if (!text) return undefined
  const flat = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return flat || undefined
}

/**
 * Champs RESTANTS d'un événement, une fois retirés ceux déjà rendus par la ligne. C'est ce qui
 * faisait la pauvreté du journal : `sessionId`, `provider`, `attempt`, `requestId`, `streamId`,
 * `journalPath`, `error`… étaient lus depuis le fichier puis jetés à l'affichage.
 */
function rest(source: Record<string, unknown>, ...omit: string[]): string | undefined {
  const ignored = new Set(['kind', 'at', ...omit])
  const keep: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (ignored.has(key) || value === undefined || value === null || value === '') continue
    keep[key] = value
  }
  return Object.keys(keep).length === 0 ? undefined : short(keep)
}

/** Concatène deux fragments de détail sans en perdre un seul. */
function joinDetail(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((part): part is string => Boolean(part))
  return kept.length === 0 ? undefined : kept.join(' · ')
}

/** Ligne en cours de construction : la SOURCE est apposée à la sortie, jamais devinée ligne à ligne. */
type Brute = Omit<ModelActivityEntry, 'source'>

/** Appose la source sur un lot de lignes. */
function tag(source: ModelActivitySource, entries: Brute[]): ModelActivityEntry[] {
  return entries.map((entry) => ({ ...entry, source }))
}

/** Gestes d'un tour reconstruits depuis ses PARTS persistées (source durable). */
function fromParts(
  turnId: string,
  parts: ReadonlyArray<Record<string, unknown>>
): Brute[] {
  const out: Brute[] = []
  parts.forEach((part, index) => {
    const id = `${turnId}:part:${index}`
    if (part.kind === 'text') {
      const detail = short(part.text)
      if (detail) out.push({ id, turnId, kind: 'text', label: 'Réponse', detail, ...stamp(part) })
      return
    }
    if (part.kind === 'action') {
      const detail = joinDetail(short(part.args), rest(part, 'args', 'name', 'ok'))
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
      const detail = joinDetail(short(artifact), rest(part, 'artifact'))
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
      const detail = joinDetail(short(part.message), rest(part, 'message', 'cause'))
      out.push({
        id,
        turnId,
        kind: 'error',
        label: `Erreur (${String(part.cause ?? 'turn')})`,
        ...stamp(part),
        ...(detail ? { detail } : {}),
        ok: false
      })
      return
    }
    // Même règle que pour le journal : une part d'un type non prévu ici reste VISIBLE.
    const detail = rest(part)
    out.push({
      id,
      turnId,
      kind: 'event',
      label: String(part.kind ?? 'part'),
      ...stamp(part),
      ...(detail ? { detail } : {})
    })
  })
  return out
}

/** Gestes d'un tour reconstruits depuis son JOURNAL fichier (source la plus complète). */
function fromJournal(
  turnId: string,
  events: ReadonlyArray<Record<string, unknown>>
): Brute[] {
  const out: Brute[] = []
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
      const detail = joinDetail(short(event.args), rest(event, 'args', 'name'))
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
      const detail = joinDetail(short(event.args), rest(event, 'args', 'name', 'actionId'))
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
      const detail = joinDetail(short(event.data), rest(event, 'data', 'name', 'actionId', 'ok'))
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
    if (kind === 'error' || kind === 'failed') {
      const detail = joinDetail(
        short(event.text ?? event.error ?? event.message),
        rest(event, 'text', 'error', 'message')
      )
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
      const detail = joinDetail(short(artifact), rest(event, 'artifact'))
      out.push({
        id,
        turnId,
        kind: 'artifact',
        label: String(artifact.name ?? artifact.id ?? 'artefact'),
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'done' || kind === 'cancelled') {
      const usage = event.usage as Record<string, unknown> | undefined
      const detail = joinDetail(
        event.outcome ? `issue ${String(event.outcome)}` : undefined,
        usage ? short(usage) : undefined,
        rest(event, 'usage', 'outcome')
      )
      out.push({
        id,
        turnId,
        kind: 'done',
        label: kind === 'cancelled' ? 'Tour annulé' : 'Tour terminé',
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    // RIEN NE SE PERD — tout autre geste journalisé (`provider-journal`, `stream-reset`, `resumed`,
    // `interrupted`, un `kind` ajouté demain côté main) devenait un TROU dans le journal : la liste
    // blanche ci-dessus le jetait en silence. Il s'affiche désormais tel quel, champs compris.
    if (kind) {
      const detail = rest(event)
      out.push({
        id,
        turnId,
        kind: 'event',
        label: kind,
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
    }
  })
  const head: Brute[] = []
  if (reasoning.trim())
    head.push({
      id: `${turnId}:reasoning`,
      turnId,
      kind: 'reasoning',
      label: 'Raisonnement',
      ...reasoningAt,
      detail: short(reasoning)
    })
  const tail: Brute[] = []
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

/** Horodatage ISO d'un événement causal → epoch. Jamais inventé. */
function isoStamp(value: unknown): { at?: number } {
  if (typeof value !== 'string') return {}
  const at = Date.parse(value)
  return Number.isFinite(at) ? { at } : {}
}

const CAUSAL_KIND: Record<string, ModelActivityKind> = {
  message: 'prompt',
  injection: 'injection',
  boundary: 'boundary',
  'tool-call': 'action',
  'tool-result': 'action',
  'model-response': 'text',
  'response-displayed': 'text',
  artifact: 'artifact',
  error: 'error',
  decision: 'event',
  verdict: 'event',
  gate: 'event',
  retry: 'event',
  cancellation: 'event',
  handoff: 'event'
}

/**
 * Gestes reconstruits depuis la TRACE CAUSALE de la conversation — la matière que l'Observatory
 * analysait, et que ce journal ne lisait pas du tout : contexte injecté, frontières de confiance,
 * appels d'outils, verdicts, refus. Chaque charge (`payloads`) est rendue ENTIÈRE.
 */
function fromCausal(events: ReadonlyArray<Record<string, unknown>>): Brute[] {
  return events.map((event, index) => {
    const type = String(event.type ?? 'event')
    const actor = (event.actor ?? {}) as Record<string, unknown>
    const payloads = Array.isArray(event.payloads)
      ? (event.payloads as Array<Record<string, unknown>>)
      : []
    const corps = payloads
      .map((payload) =>
        joinDetail(
          payload.name
            ? `${String(payload.kind ?? 'charge')} « ${String(payload.name)} »`
            : String(payload.kind ?? 'charge'),
          short(payload.content)
        )
      )
      .filter((part): part is string => Boolean(part))
    const statut = String(event.status ?? '')
    const detail = joinDetail(
      corps.join('\n') || undefined,
      rest(
        event,
        'schema',
        'id',
        'conversationId',
        'turnId',
        'timestamp',
        'type',
        'actor',
        'payloads',
        'status'
      )
    )
    return {
      id: `causal:${String(event.id ?? index)}`,
      turnId: String(event.turnId ?? ''),
      kind: CAUSAL_KIND[type] ?? 'event',
      label: joinDetail(type, short(actor.label)) ?? type,
      ...isoStamp(event.timestamp),
      ...(statut === 'failed' || statut === 'cancelled' ? { ok: false } : {}),
      ...(statut === 'completed' ? { ok: true } : {}),
      ...(detail ? { detail } : {})
    }
  })
}

/**
 * Gestes reconstruits depuis le journal d'ACTIVITÉ facturée : c'est la seule source qui porte le
 * provider, le modèle, l'effort de raisonnement, les tokens, le coût et la durée réels.
 */
function fromActivity(entries: ReadonlyArray<Record<string, unknown>>): Brute[] {
  return entries.map((entry, index) => {
    const chiffres = [
      entry.provider ? String(entry.provider) : undefined,
      entry.model ? String(entry.model) : undefined,
      entry.reasoningEffort ? `effort ${String(entry.reasoningEffort)}` : undefined,
      typeof entry.inputTokens === 'number' ? `in ${entry.inputTokens}` : undefined,
      typeof entry.outputTokens === 'number' ? `out ${entry.outputTokens}` : undefined,
      typeof entry.cacheReadTokens === 'number' ? `cache ${entry.cacheReadTokens}` : undefined,
      typeof entry.costUsd === 'number' ? `${entry.costUsd} $` : undefined,
      typeof entry.durationMs === 'number' ? `${entry.durationMs} ms` : undefined
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ')
    const detail = joinDetail(
      chiffres || undefined,
      short(entry.text),
      rest(
        entry,
        'ts',
        'label',
        'provider',
        'model',
        'reasoningEffort',
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'costUsd',
        'durationMs',
        'text'
      )
    )
    return {
      id: `activity:${index}:${String(entry.ts ?? '')}`,
      turnId: '',
      kind: 'usage' as ModelActivityKind,
      label: joinDetail(String(entry.kind ?? 'appel'), short(entry.label)) ?? 'appel',
      ...isoStamp(entry.ts),
      ...(detail ? { detail } : {})
    }
  })
}

/**
 * Écarte les doublons EXACTS entre sources (la même réponse vue par le journal et par les parts),
 * et JAMAIS deux lignes qui diffèrent d'un caractère : en cas de doute, la ligne reste.
 */
function dedupe(entries: ModelActivityEntry[]): ModelActivityEntry[] {
  const vues = new Set<string>()
  return entries.filter((entry) => {
    const cle = `${entry.turnId}|${entry.kind}|${entry.label}|${entry.detail ?? ''}`
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

/**
 * Tri chronologique STABLE. Une ligne sans heure (parts persistées, message du fil) n'est pas
 * envoyée en tête : elle hérite de la dernière heure connue AVANT elle, donc garde sa place dans le
 * fil au lieu de flotter.
 */
function trierChronologiquement(entries: ModelActivityEntry[]): ModelActivityEntry[] {
  let derniere = Number.NEGATIVE_INFINITY
  const decore = entries.map((entry, index) => {
    if (typeof entry.at === 'number') derniere = entry.at
    return { entry, cle: derniere, index }
  })
  return decore
    .sort((a, b) => (a.cle === b.cle ? a.index - b.index : a.cle - b.cle))
    .map((porte) => porte.entry)
}

/**
 * Construit le journal affichable. Les QUATRE sources sont UNIES (jamais l'une à la place d'une
 * autre), les doublons exacts écartés, et l'ensemble trié chronologiquement. Un tour dont le journal
 * fichier a été nettoyé reste présent via ses parts durables.
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
        source: 'thread',
        ...(detail ? { detail } : {})
      })
      return
    }
    const turnId = (message as { turnId?: string }).turnId ?? `message-${messageIndex}`
    const journal = input.journalByTurn[turnId]
    const parts = ((message as { parts?: unknown[] }).parts ?? []) as Array<Record<string, unknown>>
    // UNION, et non alternative : le journal porte le raisonnement et l'usage, les parts portent ce
    // qui a ete PERSISTE. Prendre l'un « a la place » de l'autre perdait a chaque fois quelque chose.
    entries.push(
      ...tag('journal', journal && journal.length > 0 ? fromJournal(turnId, journal) : [])
    )
    entries.push(...tag('parts', fromParts(turnId, parts)))
  })
  entries.push(...tag('causal', fromCausal(input.causal ?? [])))
  entries.push(...tag('activity', fromActivity(input.activity ?? [])))
  return trierChronologiquement(dedupe(entries))
}
