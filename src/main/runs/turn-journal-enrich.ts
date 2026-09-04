import { sanitizePersistedValue } from '../../shared/chat-turn'
import type { TurnJournalEvent } from './turn-journal'

/**
 * ENRICHISSEMENT DU JOURNAL DE TOUR — « le log doit contenir absolument tout, c'est lui qui sera
 * analysé à la place de l'Observatory ».
 *
 * Constat mesuré sur les journaux réels (`turn-journals/*.jsonl`) : dix `kind` seulement y
 * figuraient (`delta, provider-journal, command, result, done, artifact, failed, resumed,
 * cancelled, stream-reset`). Tout ce qui fait la VALEUR de l'Observatory — appel provider (prompt
 * système, options, usage/coût, modèle résolu), raisonnement du modèle, issue d'orchestration —
 * était produit puis écrit AILLEURS (trace-store), jamais dans le journal de la conversation.
 * Aucun correctif d'affichage ne peut rendre visible ce qui n'est pas écrit : la cause est ICI.
 *
 * Deux bornes assumées :
 *  - le prompt SYSTÈME est volumineux et quasi constant sur un tour → il n'est écrit EN ENTIER que
 *    lorsqu'il CHANGE ; les appels suivants ne portent que sa signature (taille) ;
 *  - tout texte venu du provider passe par `sanitizePersistedValue` (masque clés/secrets, borne
 *    profondeur et longueur) avant d'atteindre le fichier ; les MESURES (tokens, coût) empruntent
 *    `measures()`, ce filtre-là masquant toute clé contenant « token ».
 */

/**
 * Copie PLATE des mesures d'un appel (tokens, coût, durée, modèle).
 *
 * `sanitizePersistedValue` ne convient PAS ici : son filtre de secrets masque toute clé contenant
 * « token », donc `inputTokens`/`outputTokens`/`totalTokens` — mesuré en test, l'usage arrivait
 * dans le journal en `"[masqué]"`. Ces champs sont des NOMBRES normalisés par l'adaptateur, jamais
 * un secret ; on ne garde que des primitives, ce qui interdit de toute façon d'embarquer un objet
 * porteur d'identifiants.
 */
function measures(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input))
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string') out[key] = value.slice(0, 200)
  return out
}

/** Ce qu'un tour doit retenir entre deux appels pour ne pas ré-écrire le même prompt système. */
export interface PromptJournalMemory {
  system?: string
  /** Dernière demande utilisateur DÉJÀ écrite dans ce tour — une itération ne la répète pas. */
  userText?: string
}

/**
 * DERNIER message utilisateur porteur de texte, ou chaîne vide.
 *
 * `messages` est volontairement typé `unknown[]` dans `PromptCallLike` (ce point d'écriture accepte
 * n'importe quel adaptateur) : on ne suppose donc rien de la forme et on ne retient qu'un
 * `{ role: 'user', content: string }`. Un contenu déjà structuré (blocs, images) n'est pas la
 * demande TAPÉE et n'a rien à faire ici.
 */
function derniereDemandeUtilisateur(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | undefined
    if (message?.role !== 'user') continue
    const content = message.content
    if (typeof content === 'string' && content.trim()) return content
  }
  return ''
}

export interface PromptCallLike {
  iteration?: number
  prompt?: {
    provider: string
    model?: string
    transport: string
    system?: string
    systemBlocks?: { name: string; chars: number }[]
    messages: unknown[]
    options: Record<string, unknown>
    limitation: string
  }
  response?: string
  status?: 'completed' | 'failed'
  error?: string
  callUsage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  callDurationMs?: number
  sessionId?: string
  resolvedModel?: string
}

/**
 * Événements de journal d'un appel provider. `memory` est MUTÉ : elle porte le dernier prompt
 * système déjà écrit, pour ne pas le répéter à chaque itération du même tour.
 */
export function promptCallJournalEvents(
  event: PromptCallLike,
  memory: PromptJournalMemory,
  at: number
): TurnJournalEvent[] {
  const prompt = event.prompt
  if (!prompt) return []
  const out: TurnJournalEvent[] = []
  /*
   * LA DEMANDE, PAS SON COMPTE. `prompt-call` n'écrivait que `messages: <nombre>` : sur les 394
   * journaux de tour réels, ZÉRO ligne `"kind":"user"` — le texte tapé ne vivait que dans
   * `saisies-utilisateur.jsonl`, sans identifiant de tour. Le journal ne pouvait donc pas dire ce
   * qui avait été demandé au tour X. Écrit UNE fois par tour (mémoire ci-dessus), en TÊTE de
   * l'appel pour respecter la chronologie, et passé au même filtre de secrets que le reste.
   */
  const demande = derniereDemandeUtilisateur(prompt.messages)
  if (demande && demande !== memory.userText) {
    memory.userText = demande
    out.push({
      kind: 'user',
      iteration: event.iteration ?? 0,
      chars: demande.length,
      text: sanitizePersistedValue(demande),
      at
    })
  }
  const system = prompt.system ?? ''
  if (system && system !== memory.system) {
    memory.system = system
    out.push({
      kind: 'prompt-system',
      iteration: event.iteration ?? 0,
      chars: system.length,
      ...(prompt.systemBlocks?.length ? { blocks: prompt.systemBlocks } : {}),
      text: sanitizePersistedValue(system),
      at
    })
  }
  out.push({
    kind: 'prompt-call',
    iteration: event.iteration ?? 0,
    provider: prompt.provider,
    ...(prompt.model ? { model: prompt.model } : {}),
    ...(event.resolvedModel ? { resolvedModel: event.resolvedModel } : {}),
    transport: prompt.transport,
    limitation: prompt.limitation,
    status: event.status ?? 'completed',
    ...(event.error ? { error: event.error } : {}),
    options: sanitizePersistedValue(prompt.options),
    messages: prompt.messages.length,
    systemChars: system.length,
    responseChars: (event.response ?? '').length,
    ...(event.callUsage ? { usage: measures({ ...event.callUsage }) } : {}),
    ...(typeof event.callDurationMs === 'number'
      ? { durationMs: Math.round(event.callDurationMs) }
      : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    at
  })
  return out
}

/**
 * Événements de CLÔTURE que le journal ne portait pas : le raisonnement (jusque-là écrit dans le
 * tour et dans la trace, jamais dans le journal), le coût réel du tour, et l'issue d'orchestration
 * structurée (le verdict) — les trois questions qu'on pose à l'Observatory.
 */
export function closingJournalEvents(
  input: {
    reasoning?: string
    usage?: Record<string, unknown>
    outcome?: Record<string, unknown>
  },
  at: number
): TurnJournalEvent[] {
  const out: TurnJournalEvent[] = []
  const reasoning = input.reasoning?.trim()
  if (reasoning) out.push({ kind: 'reasoning', text: sanitizePersistedValue(reasoning), at })
  if (input.usage && Object.keys(input.usage).length > 0)
    out.push({ kind: 'usage', ...measures(input.usage), at })
  if (input.outcome && Object.keys(input.outcome).length > 0)
    out.push({ kind: 'outcome', ...(sanitizePersistedValue(input.outcome) as object), at })
  return out
}

/**
 * `kind` du pilote déjà écrits AILLEURS : les huit que `applyDurableEvent` transforme en événement
 * durable (donc journalisé avec le tour) et `prompt-call`, journalisé par
 * `promptCallJournalEvents`. Les réécrire ici doublerait le journal.
 */
const DEJA_JOURNALISES = new Set([
  'delta',
  'stream-reset',
  'think',
  'command',
  'result',
  'artifact',
  'done',
  'cancellation',
  'prompt-call'
])

/**
 * Forme MINIMALE attendue d'un événement de pilote : tous les champs sont optionnels, car ce point
 * d'écriture accepte volontairement n'importe quel `kind` — y compris un futur.
 */
export interface PilotJournalEventLike {
  kind?: string
  iteration?: number
  actionId?: string
  streamId?: string
  name?: string
  ok?: boolean
  text?: string
  retryOf?: string
  data?: unknown
}

/** Champs d'un événement de pilote qui ont un sens dans le journal, dans un ordre stable. */
const CHAMPS_PILOTE = [
  'iteration',
  'actionId',
  'streamId',
  'name',
  'ok',
  'text',
  // Lien vers l'echec rattrape : liste FERMEE, un champ absent d'ici est perdu en silence.
  'retryOf',
  'data'
] as const

/**
 * TOUT le reste du pilote dans le journal — `error`, `retry`, `provider-status`,
 * `action-progress`, le `reasoning` par itération, et tout `kind` FUTUR.
 *
 * Mesuré sur `applyDurableEvent` (`src/main/index.ts`) : un `kind` qui ne produit pas d'événement
 * durable n'atteint AUCUN fichier. Une erreur provider, une nouvelle tentative ou l'avancement
 * d'une commande longue étaient donc produits puis jetés à la frontière d'écriture — d'où un
 * journal où « on ne voit rien ». Le défaut par défaut est ici INVERSÉ : un `kind` inconnu est
 * écrit tel quel plutôt que perdu en silence.
 *
 * `reasoning` devient `reasoning-step` : la clôture écrit déjà un `reasoning` AGRÉGÉ, et deux sens
 * différents sous un même nom rendraient le journal inexploitable.
 */
export function pilotJournalEvents(event: PilotJournalEventLike, at: number): TurnJournalEvent[] {
  const kind = typeof event.kind === 'string' ? event.kind : ''
  if (!kind || DEJA_JOURNALISES.has(kind)) return []
  const source = event as Record<string, unknown>
  const out: TurnJournalEvent = { kind: kind === 'reasoning' ? 'reasoning-step' : kind }
  for (const champ of CHAMPS_PILOTE) {
    const value = source[champ]
    if (value === undefined) continue
    out[champ] = sanitizePersistedValue(value)
  }
  out.at = at
  return [out]
}
