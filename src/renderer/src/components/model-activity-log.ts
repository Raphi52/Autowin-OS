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
  /**
   * SIGNE DE VIE du fournisseur (outil en cours, nouvelle tentative, tâche de fond) — la seconde
   * matière du bloc « Réflexion » du fil, à côté de la pensée. Elle arrivait bien jusqu'au journal
   * mais y était rangée en « Journal » fourre-tout : illisible et infiltrable.
   */
  | 'status'
  /**
   * Aller-retour avec le BRAIN : savoir récupéré (préchargé, `brain_query`, empreinte, recherche)
   * ou fait DÉPOSÉ par `remember`. Sans lui, le journal montrait le modèle répondre sans jamais
   * montrer ce qu'il avait lu.
   */
  | 'brain'
  /**
   * Travail d'un SOUS-AGENT dans sa copie de travail isolee : etat, fichiers touches, blocage.
   * Invisible depuis le fil, alors que c'est la que le travail se fait reellement.
   */
  | 'agent'
  /** Tout geste journalisé qui n'entre dans AUCUNE des catégories ci-dessus. Rien ne se perd. */
  | 'event'

/** D'où vient la ligne. Affiché et filtrable : une preuve sans provenance n'en est pas une. */
export type ModelActivitySource =
  | 'thread'
  | 'journal'
  | 'parts'
  | 'causal'
  | 'activity'
  | 'brain'
  | 'prompts'
  /** Copies de travail isolees des sous-agents (`getWorktreeActivity`). */
  | 'bureaux'

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
  /**
   * Champs BRUTS du geste, tels que la source les a écrits — clé par clé, sans aplatissement.
   * `detail` reste la version texte (elle porte le filtre et la ligne repliée) ; `fields` porte la
   * MÊME matière en structure, pour que l'affichage puisse la déplier au lieu de la lire à plat.
   */
  fields?: Record<string, unknown>
}

export interface ModelActivityInput {
  messages: readonly Msg[]
  /** Événements bruts du journal fichier, par `turnId`. Absent = tour hors rétention. */
  journalByTurn: Record<string, ReadonlyArray<Record<string, unknown>>>
  /** Trace causale de la conversation (`autowin.trace/v1`), telle quelle. */
  causal?: ReadonlyArray<Record<string, unknown>>
  /** Journal d'activité facturée de la conversation (`activity/<conv>.jsonl`), tel quel. */
  activity?: ReadonlyArray<Record<string, unknown>>
  /**
   * Traces BRAIN de la conversation (`brain-trace-spool`), telles quelles. C'était le trou : le
   * savoir récupéré, la requête qui l'a déclenché, ce qui a été trouvé ou non, et les faits DÉPOSÉS
   * par `remember` avaient leur propre journal, lu par l'Observatory — jamais par celui-ci.
   */
  brain?: ReadonlyArray<Record<string, unknown>>
  /**
   * Appels PROMPT observés (`prompt-observability`), tels quels. C'est le prompt REELLEMENT parti au
   * modèle — son système décomposé en blocs nommés, le contexte injecté, la réponse, l'usage. Il
   * n'atteignait que l'Observatory.
   */
  promptCalls?: ReadonlyArray<Record<string, unknown>>
  /** Activite des copies de travail des sous-agents (`getWorktreeActivity`), telle quelle. */
  bureaux?: ReadonlyArray<Record<string, unknown>>
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

/**
 * Champs bruts d'un événement — TOUT ce que la source a écrit, sauf ce que la ligne rend déjà
 * elle-même (`kind`, `at`). Contrairement à `rest()`, rien n'est sérialisé : l'affichage reçoit
 * l'objet et peut le déplier clé par clé. C'est ce qui manquait : l'information ARRIVAIT jusqu'ici
 * puis était collée en une seule chaîne avant d'atteindre l'écran.
 */
function allFields(source: Record<string, unknown>): { fields?: Record<string, unknown> } {
  const keep: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'kind' || key === 'at' || value === undefined || value === null || value === '')
      continue
    keep[key] = value
  }
  return Object.keys(keep).length === 0 ? {} : { fields: keep }
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
function fromParts(turnId: string, parts: ReadonlyArray<Record<string, unknown>>): Brute[] {
  const out: Brute[] = []
  parts.forEach((part, index) => {
    const id = `${turnId}:part:${index}`
    if (part.kind === 'text') {
      const detail = short(part.text)
      if (detail)
        out.push({
          id,
          turnId,
          kind: 'text',
          label: 'Réponse',
          detail,
          ...stamp(part),
          ...allFields(part)
        })
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
        ...allFields(part),
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
        ...allFields(part),
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
        ...allFields(part),
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
      ...allFields(part),
      ...(detail ? { detail } : {})
    })
  })
  return out
}

/**
 * Pensée et signes de vie PORTÉS PAR LE MESSAGE lui-même — la matière exacte du bloc « Réflexion »
 * (`ThinkingBlock`) : `reasoning` (conservé par le tour, donc durable) et `providerStatusLog`
 * (toutes les lignes de vie du tour, dans l'ordre). Sans heure : le message ne l'inscrit pas, et on
 * n'en invente aucune — le tri chronologique les garde à leur place dans le fil.
 */
function fromMessageThinking(turnId: string, message: Msg): Brute[] {
  const out: Brute[] = []
  const pensee = short((message as { reasoning?: string }).reasoning)
  if (pensee)
    out.push({
      id: `${turnId}:thread:reasoning`,
      turnId,
      kind: 'reasoning',
      label: 'Raisonnement',
      detail: pensee
    })
  const vies = ((message as { providerStatusLog?: string[] }).providerStatusLog ?? []).filter(
    (ligne): ligne is string => typeof ligne === 'string' && ligne.trim() !== ''
  )
  vies.forEach((ligne, index) => {
    out.push({ id: `${turnId}:thread:status:${index}`, turnId, kind: 'status', label: ligne })
  })
  return out
}

/** Gestes d'un tour reconstruits depuis son JOURNAL fichier (source la plus complète). */
function fromJournal(turnId: string, events: ReadonlyArray<Record<string, unknown>>): Brute[] {
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
    if (kind === 'provider-status') {
      // Exactement ce que le bloc « Réflexion » écrit ligne à ligne pendant l'attente.
      const ligne = short(event.text)
      const detail = rest(event, 'text')
      out.push({
        id,
        turnId,
        kind: 'status',
        label: ligne ?? 'signe de vie',
        ...stamp(event),
        ...allFields(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'reasoning-step') {
      // Pensée d'UNE itération (le journal écrit aussi un `reasoning` agrégé à la clôture) : elle
      // se lit comme une réflexion, pas comme un geste anonyme.
      const detail = joinDetail(short(event.text), rest(event, 'text', 'iteration'))
      out.push({
        id,
        turnId,
        kind: 'reasoning',
        label: `Raisonnement (étape ${String(event.iteration ?? '?')})`,
        ...stamp(event),
        ...allFields(event),
        ...(detail ? { detail } : {})
      })
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
        ...allFields(event),
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
        ...allFields(event),
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
        const champsResultat = allFields(event).fields
        out[position] = {
          ...target,
          ...(ok === undefined ? {} : { ok }),
          ...(detail ? { detail } : {}),
          // La commande porte ses `args`, le résultat ses `data` : la ligne fusionnée garde les deux.
          ...(target.fields || champsResultat
            ? { fields: { ...(target.fields ?? {}), ...(champsResultat ?? {}) } }
            : {})
        }
        return
      }
      out.push({
        id,
        turnId,
        kind: 'action',
        label: String(event.name ?? 'résultat'),
        ...stamp(event),
        ...allFields(event),
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
        ...allFields(event),
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
        ...allFields(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'prompt-system') {
      // Le prompt SYSTÈME entier, tel qu'il est parti au modèle : la première chose qu'on venait
      // chercher dans l'Observatory. Il était rangé en « Journal » fourre-tout, donc infiltrable.
      const detail = joinDetail(short(event.text), rest(event, 'text'))
      out.push({
        id,
        turnId,
        kind: 'prompt',
        label: 'Prompt système',
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'usage') {
      // Appel FACTURÉ écrit par le journal du tour (tokens, coût, durée) — même nature que les
      // lignes du journal d'activité, donc même catégorie « Coût ».
      const detail = rest(event)
      out.push({
        id,
        turnId,
        kind: 'usage',
        label: 'Appel facturé',
        ...stamp(event),
        ...(detail ? { detail } : {})
      })
      return
    }
    if (kind === 'outcome') {
      // Issue du tour telle que le main l'a inscrite (statut, raison, verdict) : c'est une FIN.
      const detail = rest(event)
      out.push({
        id,
        turnId,
        kind: 'done',
        label: 'Issue du tour',
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
        ...allFields(event),
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
        ...allFields(event),
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
      ...allFields(event),
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
      ...allFields(entry),
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
    // Un signe de vie vu DEUX FOIS (porté par le message live ET par le journal) est la MÊME
    // ligne : sa clé ignore les champs annexes (`iteration`), que seule la copie journal porte.
    const cle =
      entry.kind === 'status'
        ? `${entry.turnId}|status|${entry.label}`
        : `${entry.turnId}|${entry.kind}|${entry.label}|${entry.detail ?? ''}`
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

/**
 * Écarte la copie TRONQUÉE de la pensée. Le tour ne conserve que les 4 000 derniers caractères du
 * raisonnement (`REASONING_MAX`, `src/shared/chat-turn.ts`) alors que le journal fichier en porte la
 * TOTALITÉ : les deux lignes n'étant pas identiques, le dédoublonnage exact les laissait toutes les
 * deux, et la plus courte n'apportait rien. On garde donc l'entière, et la copie du fil ne survit
 * que lorsque le journal a été nettoyé (au-delà de 7 jours) — c'est elle qui rend la Réflexion
 * DURABLE.
 */
function ecarterPenseeTronquee(entries: ModelActivityEntry[]): ModelActivityEntry[] {
  const entieres = new Map<string, string>()
  for (const entry of entries) {
    if (entry.kind !== 'reasoning' || entry.source !== 'journal' || !entry.detail) continue
    const deja = entieres.get(entry.turnId) ?? ''
    if (entry.detail.length > deja.length) entieres.set(entry.turnId, entry.detail)
  }
  return entries.filter((entry) => {
    if (entry.kind !== 'reasoning' || entry.source !== 'journal') {
      if (entry.kind !== 'reasoning' || !entry.detail) return true
      const entiere = entieres.get(entry.turnId)
      return !(entiere && entiere.includes(entry.detail))
    }
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
/** État d'une copie de travail, dit en clair. */
const ETAT_BUREAU: Record<string, string> = {
  isolated: 'isolée',
  working: 'au travail',
  ready: 'prête',
  merged: 'publiée',
  conflict: 'en conflit',
  blocked: 'bloquée',
  interrupted: 'interrompue'
}

/**
 * TRAVAIL DES SOUS-AGENTS, dans leur copie isolée. C'est là que les fichiers changent réellement,
 * et le fil n'en montrait rien : ni les fichiers touchés, ni l'état de la copie, ni la raison pour
 * laquelle elle attend. Un travail « terminé » mais jamais publié devient visible ICI, à sa date.
 */
function fromBureaux(bureaux: ReadonlyArray<Record<string, unknown>>): Brute[] {
  return bureaux.map((bureau, index) => {
    const etatBrut = typeof bureau.state === 'string' ? bureau.state : ''
    const etat = ETAT_BUREAU[etatBrut] ?? etatBrut
    const fichiers = Array.isArray(bureau.files) ? bureau.files : []
    const chemins = fichiers
      .map((fichier) => {
        const item = fichier as { path?: unknown; kind?: unknown }
        return typeof item?.path === 'string'
          ? `${typeof item.kind === 'string' ? `${item.kind} ` : ''}${item.path}`
          : ''
      })
      .filter((chemin) => chemin !== '')
    const detail = joinDetail(
      short(bureau.task),
      chemins.length > 0 ? `${chemins.length} fichier(s) : ${chemins.join(', ')}` : undefined,
      typeof bureau.attentionReason === 'string' ? `attente : ${bureau.attentionReason}` : undefined,
      typeof bureau.conflictFile === 'string' ? `conflit sur ${bureau.conflictFile}` : undefined,
      rest(bureau, 'task', 'files', 'attentionReason', 'conflictFile', 'state', 'startedAtMs')
    )
    return {
      id: `bureau:${String(bureau.agentId ?? index)}`,
      // Un bureau appartient a une CONVERSATION, pas a un tour : il traverse plusieurs tours.
      turnId: typeof bureau.turnId === 'string' ? bureau.turnId : '',
      kind: 'agent' as ModelActivityKind,
      label: joinDetail(short(bureau.agentName) ?? 'sous-agent', etat || undefined) ?? 'sous-agent',
      ...(typeof bureau.startedAtMs === 'number' ? { at: bureau.startedAtMs } : {}),
      ...allFields(bureau),
      ...(detail ? { detail } : {}),
      ...(etatBrut === 'merged'
        ? { ok: true }
        : etatBrut === 'conflict' || etatBrut === 'blocked' || etatBrut === 'interrupted'
          ? { ok: false }
          : {})
    }
  })
}

/** Blocs nommés d'un prompt (système ou contexte), rendus « nom (n car.) » sans rien inventer. */
function blocs(valeur: unknown): string | undefined {
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined
  const noms = valeur
    .map((bloc) => {
      const item = bloc as { name?: unknown; chars?: unknown }
      if (typeof item?.name !== 'string') return ''
      return typeof item.chars === 'number' ? `${item.name} (${item.chars})` : item.name
    })
    .filter((nom) => nom !== '')
  return noms.length === 0 ? undefined : noms.join(', ')
}

/**
 * APPELS PROMPT — ce qui est REELLEMENT parti au modèle. Le journal savait dire qu'un appel avait
 * eu lieu ; il ne disait pas ce qu'il CONTENAIT. Chaque appel porte ici son acteur, sa phase, son
 * fournisseur, le modèle demandé ET celui réellement servi, la décomposition du prompt système et
 * du contexte injecté en blocs nommés, la durée, l'usage, et l'erreur s'il a échoué. Le contenu
 * intégral (messages, options, réponse) reste dans les champs bruts, dépliables.
 */
function fromPromptCalls(calls: ReadonlyArray<Record<string, unknown>>): Brute[] {
  return calls.map((call, index) => {
    const statut = typeof call.status === 'string' ? call.status : undefined
    const modele =
      call.resolvedModel && call.resolvedModel !== call.model
        ? `${String(call.model ?? '?')} → ${String(call.resolvedModel)}`
        : short(call.resolvedModel ?? call.model)
    const systeme = blocs(call.systemBlocks)
    const contexte = blocs(call.contextBlocks)
    const detail = joinDetail(
      modele ? `modèle : ${modele}` : undefined,
      systeme ? `système : ${systeme}` : undefined,
      contexte ? `contexte injecté : ${contexte}` : undefined,
      typeof call.durationMs === 'number' ? `${call.durationMs} ms` : undefined,
      short(call.error),
      short(call.response)
    )
    return {
      id: `prompt:${String(call.id ?? index)}`,
      turnId: typeof call.turnId === 'string' ? call.turnId : '',
      kind: 'prompt' as ModelActivityKind,
      label:
        joinDetail(
          'Prompt envoyé',
          short(call.actor),
          short(call.phase),
          short(call.provider),
          typeof call.iteration === 'number' ? `étape ${call.iteration}` : undefined
        ) ?? 'Prompt envoyé',
      ...isoStamp(call.ts),
      ...allFields(call),
      ...(detail ? { detail } : {}),
      ...(statut === 'completed' ? { ok: true } : statut === 'failed' ? { ok: false } : {})
    }
  })
}

/** Nature de l'aller-retour Brain, dite en clair plutôt qu'en code interne. */
const BRAIN_NATURE: Record<string, string> = {
  automatic: 'contexte préchargé',
  query: 'brain_query',
  empreinte: 'empreinte du dépôt',
  recherche: 'recherche humaine',
  depot: 'dépôt d’un fait'
}

/**
 * Gestes du BRAIN — le savoir récupéré ou déposé pendant la conversation. Cette matière avait son
 * propre journal (`brain-trace-spool`) mais n'atteignait que l'Observatory : dans le journal du
 * chat, on voyait le modèle répondre sans jamais voir CE QU'IL AVAIT LU. On rend ici la requête, la
 * nature de l'appel, l'issue (trouvé / vide / indisponible) et le volume réellement injecté.
 */
function fromBrain(traces: ReadonlyArray<Record<string, unknown>>): Brute[] {
  return traces.map((trace, index) => {
    const kind = typeof trace.kind === 'string' ? trace.kind : ''
    const nature = BRAIN_NATURE[kind] ?? kind ?? ''
    const statut = typeof trace.status === 'string' ? trace.status : undefined
    const injecte = typeof trace.injectedChars === 'number' ? trace.injectedChars : undefined
    const detail = joinDetail(
      short(trace.query),
      statut ? `issue : ${statut}` : undefined,
      injecte !== undefined ? `${injecte} caractères injectés` : undefined,
      rest(trace, 'query', 'status', 'injectedChars', 'timestamp', 'kind')
    )
    // L'ÉCHEC d'une récupération est un fait : un savoir vide ou indisponible explique une réponse
    // pauvre. On ne le peint en rouge que lorsque la trace le dit elle-même.
    const ok =
      statut === 'found' || trace.found === true
        ? true
        : statut === 'empty' || statut === 'invalid' || statut === 'unavailable' || trace.found === false
          ? false
          : undefined
    return {
      id: `brain:${String(trace.id ?? index)}`,
      turnId: typeof trace.turnId === 'string' ? trace.turnId : '',
      kind: 'brain' as ModelActivityKind,
      label: joinDetail('Brain', nature || undefined) ?? 'Brain',
      ...isoStamp(trace.timestamp),
      ...allFields(trace),
      ...(detail ? { detail } : {}),
      ...(ok === undefined ? {} : { ok })
    }
  })
}

/**
 * Tour qu'OUVRE une demande utilisateur : le premier message d'assistant qui la suit. Sans lui, la
 * demande flotte hors de tout tour et le regroupement par tour perd son point de départ. Une
 * demande sans réponse (tour en cours, tour perdu) garde un identifiant qui lui est propre.
 */
function turnIdDuTourSuivant(messages: readonly Msg[], depuis: number): string {
  for (let index = depuis + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') break
    const turnId = (message as { turnId?: string }).turnId
    if (turnId) return turnId
  }
  return `message-${depuis}`
}

export function buildModelActivityLog(input: ModelActivityInput): ModelActivityEntry[] {
  const entries: ModelActivityEntry[] = []
  input.messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      const detail = short((message as { content?: string }).content)
      entries.push({
        id: `user:${messageIndex}`,
        // La demande APPARTIENT au tour qu'elle ouvre. Avec un `turnId` vide, toutes les demandes
        // de la conversation se retrouvaient rassemblees dans un meme pseudo-tour, detachees de
        // ce qu'elles avaient declenche.
        turnId: turnIdDuTourSuivant(input.messages, messageIndex),
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
    // CE QUE MONTRE LE BLOC « RÉFLEXION », lu à sa source d'affichage. La pensée survit dans le
    // TOUR (`message.reasoning`) quand le journal fichier a été nettoyé, et les signes de vie du
    // fournisseur n'existent parfois que dans le message live : sans ces deux lignes, le journal
    // montrait MOINS que la bulle du fil. Les copies déjà portées par le journal sont écartées.
    entries.push(...tag('thread', fromMessageThinking(turnId, message)))
  })
  entries.push(...tag('causal', fromCausal(input.causal ?? [])))
  entries.push(...tag('activity', fromActivity(input.activity ?? [])))
  entries.push(...tag('brain', fromBrain(input.brain ?? [])))
  entries.push(...tag('prompts', fromPromptCalls(input.promptCalls ?? [])))
  entries.push(...tag('bureaux', fromBureaux(input.bureaux ?? [])))
  return trierChronologiquement(ecarterPenseeTronquee(dedupe(entries)))
}
