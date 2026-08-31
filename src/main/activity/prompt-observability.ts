import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import type { Message, Usage } from '../providers/types'
import type { PipelinePhase } from '../skill-pipeline'
import type { TokenUsage } from '../../shared/token-usage'

export interface PromptCallRecord {
  id: string
  /** Récupération Brain effectivement disponible au moment de construire cet appel. */
  brainTraceId?: string
  ts: string
  conversationId: string
  turnId: string
  iteration: number
  actor: string
  /** Phase d'execution reelle ; absente uniquement sur les anciens journaux. */
  phase?: PipelinePhase
  provider: string
  /** Modele demande a l'adaptateur, alias compris. */
  model?: string
  /** Modele concret rapporte par le provider apres execution. */
  resolvedModel?: string
  transport: string
  boundary: string
  limitation: string
  system?: string
  /** F6 — décomposition du `system` en blocs nommés (skill/discipline/style/capacités/contexte). */
  systemBlocks?: { name: string; chars: number }[]
  /**
   * Décomposition du contexte poussé côté USER en blocs nommés (mémoire de session, mémoire
   * causale, empreinte du dépôt, savoir Brain, contexte collecté…). Ajouté le 2026-08-31 : ces
   * injections-là étaient concaténées dans le message utilisateur, donc indiscernables de ce que
   * l'humain avait écrit — l'Observatory les montrait sans jamais pouvoir les nommer.
   */
  contextBlocks?: { name: string; chars: number }[]
  messages: Message[]
  options: Record<string, unknown>
  response: string
  status?: 'completed' | 'failed'
  error?: string
  usage?: Usage
  durationMs?: number
  sessionId?: string
}

export function promptObservabilityRoot(): string {
  return join(ensureAutowinAppData(), 'prompt-observability')
}

function fileFor(conversationId: string, root: string): string {
  return join(root, `${conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`)
}

const WINDOWS_1252_BYTES = new Map<string, number>([
  ['\u20ac', 0x80],
  ['\u201a', 0x82],
  ['\u0192', 0x83],
  ['\u201e', 0x84],
  ['\u2026', 0x85],
  ['\u2020', 0x86],
  ['\u2021', 0x87],
  ['\u02c6', 0x88],
  ['\u2030', 0x89],
  ['\u0160', 0x8a],
  ['\u2039', 0x8b],
  ['\u0152', 0x8c],
  ['\u017d', 0x8e],
  ['\u2018', 0x91],
  ['\u2019', 0x92],
  ['\u201c', 0x93],
  ['\u201d', 0x94],
  ['\u2022', 0x95],
  ['\u2013', 0x96],
  ['\u2014', 0x97],
  ['\u02dc', 0x98],
  ['\u2122', 0x99],
  ['\u0161', 0x9a],
  ['\u203a', 0x9b],
  ['\u0153', 0x9c],
  ['\u017e', 0x9e],
  ['\u0178', 0x9f]
])

function mojibakeScore(value: string): number {
  return (value.match(/(?:Ã.|Â.|â..|ð...)/g) ?? []).length
}

function restoreMisdecodedUtf8(value: string): string {
  const initialScore = mojibakeScore(value)
  if (initialScore === 0) return value

  const bytes: number[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const byte = codePoint <= 0xff ? codePoint : WINDOWS_1252_BYTES.get(character)
    if (byte === undefined) return value
    bytes.push(byte)
  }

  try {
    const restored = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
    return mojibakeScore(restored) < initialScore ? restored : value
  } catch {
    return value
  }
}

function restoreObservedValue<T>(value: T): T {
  if (typeof value === 'string') return restoreMisdecodedUtf8(value) as T
  if (Array.isArray(value)) return value.map(restoreObservedValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, restoreObservedValue(entry)])
    ) as T
  }
  return value
}

export function appendPromptCall(
  call: Omit<PromptCallRecord, 'id' | 'ts'>,
  root = promptObservabilityRoot(),
  now: () => number = Date.now,
  makeId: () => string = randomUUID
): PromptCallRecord {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const record: PromptCallRecord = {
    ...restoreObservedValue(call),
    id: makeId(),
    ts: new Date(now()).toISOString()
  }
  appendFileSync(fileFor(call.conversationId, root), `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

export function loadPromptCalls(
  conversationId: string,
  root = promptObservabilityRoot()
): PromptCallRecord[] {
  try {
    const path = fileFor(conversationId, root)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PromptCallRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function loadAllPromptCalls(root = promptObservabilityRoot()): PromptCallRecord[] {
  try {
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => {
        const conversationId = name.slice(0, -'.jsonl'.length)
        return loadPromptCalls(conversationId, root)
      })
      .sort((a, b) => b.ts.localeCompare(a.ts))
  } catch {
    return []
  }
}

export function deletePromptCalls(
  conversationId: string,
  root = promptObservabilityRoot()
): boolean {
  const path = fileFor(conversationId, root)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** Ligne de coût agrégée pour un acteur (rôle) ou un modèle. */
export interface CostBreakdownRow extends TokenUsage {
  key: string
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /**
   * Tokens ÉCRITS dans le cache — un SOUS-ENSEMBLE de `inputTokens`, comme la lecture. Propagé
   * parce que sans lui le verdict de cache accuse une écriture de cache d'être une réécriture de
   * contexte : le premier appel d'une longue conversation INVESTIT, il ne gaspille pas. Resserré
   * en obligatoire ici : cet agrégat le calcule toujours.
   */
  cacheCreationTokens: number
  /** Part du contexte RELUE plutôt que réécrite : proche de 0 ⇒ le cache ne sert pas. */
  cacheHitRatio: number
  /** Temps cumule des appels de cette ligne. 0 = aucune source ne l'a enregistre, jamais devine. */
  durationMs: number
  /** Appels executes dont le fournisseur n'expose pas de prix fiable. */
  unpricedCalls: number
}

/**
 * Echantillon de cout NORMALISE, quelle que soit sa source.
 *
 * Necessaire car le cout d'une conversation vit dans DEUX journaux : `prompt-observability` (les
 * appels traces finement) et le journal d'activite (`kind: 'exec'`, ou atterrissent les sous-agents).
 * Mesure du 2026-07-28 sur conv-75 : le breakdown base sur les seuls prompt-calls annonçait 2,83 $
 * alors que la conversation avait coute ~20,70 $ — les deux appels dominants (10,90 $ et 5,72 $)
 * n'existaient que dans l'activite. Une mesure de cout incomplete est pire qu'aucune mesure : elle
 * fait prendre des decisions fausses avec l'air d'etre fondee.
 */
export interface CostSample extends TokenUsage {
  actor: string
  provider: string
  costUsd: number
  /** Distingue un vrai 0 $ d'un prix absent. */
  costKnown: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Tokens ECRITS dans le cache (sous-ensemble de l'entree). 0 quand la source l'ignore. */
  cacheCreationTokens: number
  /** Duree de l'appel ; 0 quand la source ne la connait pas. */
  durationMs: number
  callId?: string
}

function sampleFromCall(call: PromptCallRecord): CostSample {
  return {
    actor: call.actor || '(inconnu)',
    provider: call.provider || '(inconnu)',
    ...(call.resolvedModel || call.model ? { model: call.resolvedModel ?? call.model } : {}),
    costUsd: call.usage?.costUsd ?? 0,
    costKnown: Number.isFinite(call.usage?.costUsd),
    inputTokens: call.usage?.inputTokens ?? 0,
    outputTokens: call.usage?.outputTokens ?? 0,
    cacheReadTokens: call.usage?.cacheReadTokens ?? 0,
    cacheCreationTokens: call.usage?.cacheCreationTokens ?? 0,
    durationMs: typeof call.durationMs === 'number' && call.durationMs > 0 ? call.durationMs : 0,
    callId: call.id
  }
}

/** Entree d'activite minimale exploitable pour le cout (sous-ensemble de ConvActivityEntry). */
export interface ActivityCostEntry {
  kind?: string
  label?: string
  provider?: string
  model?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  /** Jamais enregistre par le journal d'activite a ce jour : reste 0 sur ces lignes. */
  cacheCreationTokens?: number
  durationMs?: number
  usageCallId?: string
}

/**
 * Role porte par une entree d'activite. Le `kind` DECIDE, jamais le `label` seul : sur une entree
 * `chat`, `label` contient le TEXTE du message de l'utilisateur — s'y fier faisait apparaitre
 * « reprend pardon » comme un acteur dans la repartition (constate sur les donnees reelles de
 * conv-75). Seul le kind `exec` porte un role exploitable dans son label ('subagent'/'orchestrator').
 */
function activityActor(entry: ActivityCostEntry): string {
  switch (entry.kind) {
    case 'exec':
      return entry.label || 'subagent'
    case 'judge':
      return 'judge'
    case 'conversation-route':
      return 'router'
    case 'chat':
      return 'orchestrator'
    default:
      return entry.kind || '(inconnu)'
  }
}

function sampleFromActivity(entry: ActivityCostEntry): CostSample {
  return {
    actor: activityActor(entry),
    provider: entry.provider || '(inconnu)',
    ...(entry.model ? { model: entry.model } : {}),
    costUsd: entry.costUsd ?? 0,
    costKnown: Number.isFinite(entry.costUsd),
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    cacheReadTokens: entry.cacheReadTokens ?? 0,
    cacheCreationTokens: entry.cacheCreationTokens ?? 0,
    durationMs: typeof entry.durationMs === 'number' && entry.durationMs > 0 ? entry.durationMs : 0,
    ...(entry.usageCallId ? { callId: entry.usageCallId } : {})
  }
}

/**
 * Cle d'APPARIEMENT entre les deux journaux. Le cout est la SEULE grandeur sur laquelle ils
 * s'accordent exactement.
 *
 * Constate a l'ecran le 2026-07-29 : le journal portait 16 appels / 11,00 $ et l'indicateur affichait
 * 32 appels / 21,99 $ — le double, tout compte deux fois. L'ancienne empreinte
 * `modele|cout|tokensSortie` echouait sur DEUX de ses trois composants : l'activite n'ecrit AUCUN
 * modele (`undefined`), et les deux journaux ne comptent pas les tokens de sortie pareil (1444 contre
 * 1436 sur le meme appel — l'activite inclut vraisemblablement le raisonnement). Le cout, lui, etait
 * identique au dix-millionieme (0,571592999... des deux cotes).
 */
function costMatchKey(sample: CostSample): string {
  return `${sample.provider}|${sample.costUsd.toFixed(6)}`
}

/** Un echantillon sans cout NI tokens de sortie n'apporte rien a une repartition de cout. */
function hasSpend(sample: CostSample): boolean {
  return (
    sample.costUsd !== 0 ||
    sample.inputTokens !== 0 ||
    sample.outputTokens !== 0 ||
    sample.cacheReadTokens !== 0 ||
    Boolean(sample.callId)
  )
}

/**
 * Reconcilie les deux journaux en une seule liste, SANS double comptage et SANS perte.
 *
 * APPARIEMENT UN-POUR-UN, pas un `Set` d'empreintes : chaque entree d'activite consomme AU PLUS un
 * prompt-call de meme cout. C'est ce qui distingue « le meme appel vu deux fois » (a compter une
 * fois) de « deux appels distincts au meme cout » (a compter deux fois) — un dedoublonnage par
 * ensemble ecrasait le second cas et SOUS-comptait. Les prompt-calls sont la source preferee : eux
 * seuls portent le `cacheReadTokens` et le modele. Une entree d'activite non appariee est CONSERVEE :
 * les sous-agents les plus couteux n'existent que la (mesure conv-75 : 2,83 $ vus contre ~20,70 $ reels).
 */
export function costSamplesFrom(
  calls: readonly PromptCallRecord[],
  activity: readonly ActivityCostEntry[] = []
): CostSample[] {
  const samples = calls.map(sampleFromCall).filter(hasSpend)
  const hasCanonicalCalls = samples.length > 0
  const canonicalIds = new Set(samples.flatMap((sample) => (sample.callId ? [sample.callId] : [])))
  const seenActivityIds = new Set<string>()
  // Multiset des prompt-calls encore appariables, par cle de cout. Les indices permettent aussi
  // d'enrichir une trace d'echec sans usage lorsque le provider rend ses vrais compteurs plus tard.
  const unmatched = new Map<string, number[]>()
  for (const [index, sample] of samples.entries()) {
    const key = costMatchKey(sample)
    const indices = unmatched.get(key) ?? []
    indices.push(index)
    unmatched.set(key, indices)
  }
  for (const entry of activity) {
    if (entry.usageCallId) {
      if (canonicalIds.has(entry.usageCallId) || seenActivityIds.has(entry.usageCallId)) continue
      seenActivityIds.add(entry.usageCallId)
    }
    // `chat` est un cumul de tour, pas un appel atomique. Des appels fins presents font foi.
    if (entry.kind === 'chat' && hasCanonicalCalls) continue
    const sample = sampleFromActivity(entry)
    if (!hasSpend(sample)) continue
    const key = costMatchKey(sample)
    const candidates = unmatched.get(key) ?? []
    const canonicalIndex = candidates.shift()
    if (canonicalIndex !== undefined) {
      const canonical = samples[canonicalIndex]
      // Timeout: la trace canonique existe deja mais ne connait aucun token. Le règlement tardif
      // porte la mesure réelle; la jeter au nom du dedoublonnage produirait « 1 appel, 0 token ».
      if (
        canonical.inputTokens === 0 &&
        canonical.outputTokens === 0 &&
        canonical.cacheReadTokens === 0 &&
        (sample.inputTokens > 0 || sample.outputTokens > 0 || sample.cacheReadTokens > 0)
      ) {
        samples[canonicalIndex] = {
          ...canonical,
          inputTokens: sample.inputTokens,
          outputTokens: sample.outputTokens,
          cacheReadTokens: sample.cacheReadTokens,
          costUsd: sample.costUsd,
          costKnown: sample.costKnown,
          durationMs: Math.max(canonical.durationMs, sample.durationMs)
        }
      }
      continue
    }
    samples.push(sample)
  }
  return samples
}

/** Repartition du cout a partir d'echantillons NORMALISES (les deux journaux reunis). */
export function summarizeCostSamples(
  samples: readonly CostSample[],
  dimension: 'actor' | 'model' | 'provider' = 'actor'
): CostBreakdownRow[] {
  const rows = new Map<string, CostBreakdownRow>()
  for (const sample of samples) {
    const key = (dimension === 'actor' ? sample.actor : sample[dimension]) || '(inconnu)'
    const row = rows.get(key) ?? {
      key,
      calls: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheHitRatio: 0,
      durationMs: 0,
      unpricedCalls: 0
    }
    row.calls += 1
    // Modele et provider ne sont portes par la ligne que s'ils sont UNANIMES parmi ses appels :
    // une ligne qui melange deux modeles n'a pas de tarif, et en choisir un serait inventer.
    if (row.calls === 1) {
      if (sample.model) row.model = sample.model
      if (sample.provider) row.provider = sample.provider
    } else {
      if (row.model !== sample.model) delete row.model
      if (row.provider !== sample.provider) delete row.provider
    }
    row.costUsd += sample.costUsd
    row.inputTokens += sample.inputTokens
    row.outputTokens += sample.outputTokens
    row.cacheReadTokens += sample.cacheReadTokens
    row.cacheCreationTokens += sample.cacheCreationTokens
    row.durationMs += sample.durationMs
    if (!sample.costKnown) row.unpricedCalls += 1
    rows.set(key, row)
  }
  for (const row of rows.values()) {
    row.cacheHitRatio = row.inputTokens > 0 ? Math.min(1, row.cacheReadTokens / row.inputTokens) : 0
  }
  return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd)
}
