import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { estimateCostUsd } from '../../shared/cost-estimate'
import type { PromptCallRecord } from './prompt-observability'

/**
 * RÉCUPÉRER auprès du CLI ce qu'il ne nous a pas dit — au lieu d'écrire « non exposé ».
 *
 * Un appel tué par le watchdog (« claude CLI figé — tué par le watchdog ») meurt AVANT l'event
 * `result`, le seul qui porte `usage` et `total_cost_usd`. Le journal d'appels garde donc une ligne
 * sans aucun chiffre, et l'indicateur de conversation affichait « 4,20 $ + non exposé » : le
 * montant manquant était pourtant le plus gros de la conversation.
 *
 * Ces chiffres existent ailleurs : le CLI écrit CHAQUE message assistant, avec son `usage`, dans
 * `~/.claude/projects/<projet>/<session>.jsonl`. Ce module va les y relire (lecture SEULE), les
 * borne à la fenêtre de l'appel mort, et les tarife au tarif public.
 *
 * ORACLE (mesuré le 2026-09-03, conv-1, session b5f40533) : appliquée à un appel que le CLI avait
 * DÉJÀ tarifé (2,2687 $), cette lecture rend `inputTokens` = 3 006 418 et `outputTokens` = 16 371 —
 * exactement les deux chiffres du journal. La méthode est donc vérifiée sur un cas où la vérité est
 * connue, avant d'être appliquée aux cas où elle manque.
 *
 * DEUX pièges, tous deux observés sur le transcript réel :
 * 1. Une même requête Anthropic apparaît PLUSIEURS fois (partiels de streaming) — 140 lignes pour
 *    79 requêtes. Sommer les lignes multiplierait la dépense. On dédoublonne par `requestId`.
 * 2. Le transcript est un journal de SESSION, pas d'appel : il contient aussi le travail des appels
 *    voisins, déjà tarifés. La fenêtre est donc bornée par la fin de l'appel PRÉCÉDENT de la même
 *    session — sans quoi la `durationMs` de 9 h écrite par le watchdog ferait tout ravaler.
 */

/** Ce que le CLI savait, et que le journal d'appels n'a pas reçu. */
export interface RecoveredCallUsage {
  /** Entrée TOTALE, cache inclus — l'invariant de `Usage` (cf. `normalizeClaudeUsage`). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Requêtes Anthropic DISTINCTES retrouvées dans la fenêtre (lignes dédoublonnées). */
  requests: number
  /** Modèle réellement servi, tel que le CLI l'a écrit. Absent = aucune ligne ne le nommait. */
  model?: string
  /**
   * Tarif PUBLIC appliqué aux tokens récupérés. Une ESTIMATION assumée : le CLI n'a pas eu le temps
   * de rendre son `total_cost_usd`. `undefined` quand le modèle n'a pas de tarif connu — on préfère
   * le volume à un montant inventé.
   */
  estimatedUsd?: number
  /** Fichier lu, pour que la valeur affichée reste traçable jusqu'à sa source. */
  transcript: string
}

export interface RecoveryOptions {
  /** Dossiers `projects` à balayer. Défaut : le compte Claude actif, puis `~/.claude/projects`. */
  projectsRoots?: readonly string[]
  /** Horloge pour les tarifs bornés dans le temps (tarif d'introduction). */
  nowMs?: number
}

/** Racines `projects` du CLI. `CLAUDE_CONFIG_DIR` d'abord : c'est le compte réellement utilisé. */
export function claudeProjectsRoots(): string[] {
  const roots: string[] = []
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (configured) roots.push(join(configured, 'projects'))
  const home = join(homedir(), '.claude', 'projects')
  if (!roots.includes(home)) roots.push(home)
  return roots
}

/**
 * Session du CLI telle qu'elle a été demandée sur la ligne de commande. C'est la SEULE trace de
 * session que porte un appel mort : `PromptCallRecord.sessionId` n'est rempli qu'à partir de
 * l'event `result`, celui qui manque justement ici.
 */
export function sessionIdFromArgv(argv: unknown): string | undefined {
  if (!Array.isArray(argv)) return undefined
  for (let index = 0; index < argv.length - 1; index += 1) {
    const flag = argv[index]
    if (flag !== '--resume' && flag !== '--session-id') continue
    const value = argv[index + 1]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    // Le drapeau suivant n'est pas une valeur : `--resume --model` ne nomme aucune session.
    if (!trimmed || trimmed.startsWith('-')) continue
    return trimmed
  }
  return undefined
}

function sessionIdOf(call: PromptCallRecord): string | undefined {
  const declared = typeof call.sessionId === 'string' ? call.sessionId.trim() : ''
  if (declared) return declared
  return sessionIdFromArgv((call.options as { argv?: unknown } | undefined)?.argv)
}

/** Un appel dont le provider n'a JAMAIS rendu de prix : la cible de la récupération. */
function isUnpriced(call: PromptCallRecord): boolean {
  return !Number.isFinite(call.usage?.costUsd)
}

function transcriptPath(sessionId: string, roots: readonly string[]): string | undefined {
  const file = `${sessionId}.jsonl`
  for (const root of roots) {
    if (!existsSync(root)) continue
    let projects: string[]
    try {
      projects = readdirSync(root)
    } catch {
      continue
    }
    for (const project of projects) {
      const candidate = join(root, project, file)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** Une requête Anthropic vue dans le transcript. */
interface UsageLine {
  atMs: number
  requestId: string
  model?: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

const usageCache = new Map<string, { key: string; lines: UsageLine[] }>()
/** Un transcript passé cette taille n'est plus lu d'un bloc — la mesure ne vaut pas un blocage UI. */
const MAX_TRANSCRIPT_BYTES = 40 * 1024 * 1024

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Lignes d'usage d'un transcript, en cache par (mtime, taille) : un transcript inchangé n'est jamais
 * relu, et un transcript qui grandit l'est intégralement (les lignes sont ajoutées, jamais modifiées).
 *
 * Seules les lignes qui contiennent `"usage"` sont désérialisées : un transcript de 25 Mo est fait
 * pour l'essentiel de résultats d'outils, que ce module n'a aucune raison de parser.
 */
function readUsageLines(path: string): UsageLine[] {
  let key: string
  try {
    const stats = statSync(path)
    if (stats.size > MAX_TRANSCRIPT_BYTES) return []
    key = `${stats.mtimeMs}|${stats.size}`
  } catch {
    return []
  }
  const cached = usageCache.get(path)
  if (cached?.key === key) return cached.lines
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const lines: UsageLine[] = []
  for (const line of raw.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (parsed.type !== 'assistant') continue
    const message = parsed.message as Record<string, unknown> | undefined
    const usage = message?.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const atMs = Date.parse(String(parsed.timestamp ?? ''))
    if (!Number.isFinite(atMs)) continue
    const requestId =
      (typeof parsed.requestId === 'string' && parsed.requestId) ||
      (typeof message?.id === 'string' && message.id) ||
      `${atMs}`
    lines.push({
      atMs,
      requestId,
      ...(typeof message?.model === 'string' ? { model: message.model } : {}),
      input: count(usage.input_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite: count(usage.cache_creation_input_tokens),
      output: count(usage.output_tokens)
    })
  }
  lines.sort((a, b) => a.atMs - b.atMs)
  usageCache.set(path, { key, lines })
  return lines
}

interface Window {
  startMs: number
  endMs: number
}

/**
 * Fenêtre d'un appel mort : de la fin de l'appel PRÉCÉDENT (même session) à sa propre fin. La durée
 * mesurée resserre la fenêtre quand elle est plus courte ; elle ne l'élargit jamais au-delà du
 * plancher, parce qu'une durée de watchdog n'est pas une mesure fiable (32 940 076 ms vus sur conv-1).
 */
function windowFor(call: PromptCallRecord, floorMs: number | undefined): Window | undefined {
  const endMs = Date.parse(call.ts)
  if (!Number.isFinite(endMs)) return undefined
  const duration = typeof call.durationMs === 'number' && call.durationMs > 0 ? call.durationMs : 0
  const byDuration = duration > 0 ? endMs - duration : undefined
  const startMs = Math.max(
    byDuration ?? Number.NEGATIVE_INFINITY,
    floorMs ?? Number.NEGATIVE_INFINITY
  )
  // Aucune borne : ni durée mesurée, ni appel précédent. On ne s'attribue alors RIEN, plutôt que
  // d'imputer à cet appel tout l'historique de la session.
  if (!Number.isFinite(startMs) || startMs >= endMs) return undefined
  return { startMs, endMs }
}

/**
 * Les valeurs manquantes de chaque appel non tarifé, relues auprès du CLI. Clé = `PromptCallRecord.id`.
 * Un appel absent de la table est un appel dont RIEN n'a pu être récupéré — jamais un zéro certain.
 */
export function recoverUnpricedCallsUsage(
  calls: readonly PromptCallRecord[],
  options: RecoveryOptions = {}
): Map<string, RecoveredCallUsage> {
  const recovered = new Map<string, RecoveredCallUsage>()
  const unpriced = calls.filter((call) => isUnpriced(call) && sessionIdOf(call))
  if (unpriced.length === 0) return recovered
  const roots = options.projectsRoots ?? claudeProjectsRoots()
  const nowMs = options.nowMs ?? Date.now()
  const ordered = [...calls].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  /** Requêtes déjà imputées : deux appels ne peuvent pas se partager la même requête. */
  const claimed = new Set<string>()

  for (const [index, call] of ordered.entries()) {
    if (!isUnpriced(call)) continue
    const sessionId = sessionIdOf(call)
    if (!sessionId) continue
    const endMs = Date.parse(call.ts)
    if (!Number.isFinite(endMs)) continue
    // Plancher : la fin du dernier appel de la MÊME session avant celui-ci, tarifé ou non.
    let floorMs: number | undefined
    for (let before = index - 1; before >= 0; before -= 1) {
      const previous = ordered[before]
      if (sessionIdOf(previous) !== sessionId) continue
      const previousEnd = Date.parse(previous.ts)
      if (Number.isFinite(previousEnd) && previousEnd < endMs) {
        floorMs = previousEnd
        break
      }
    }
    const span = windowFor(call, floorMs)
    if (!span) continue
    const path = transcriptPath(sessionId, roots)
    if (!path) continue
    const seen = new Map<string, UsageLine>()
    for (const line of readUsageLines(path)) {
      if (line.atMs < span.startMs || line.atMs > span.endMs) continue
      if (claimed.has(line.requestId)) continue
      seen.set(line.requestId, line)
    }
    if (seen.size === 0) continue
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let model: string | undefined
    for (const line of seen.values()) {
      claimed.add(line.requestId)
      inputTokens += line.input + line.cacheRead + line.cacheWrite
      outputTokens += line.output
      cacheReadTokens += line.cacheRead
      cacheCreationTokens += line.cacheWrite
      if (!model && line.model) model = line.model
    }
    const usage = {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      ...((model ?? call.resolvedModel ?? call.model)
        ? { model: model ?? call.resolvedModel ?? call.model }
        : {}),
      ...(call.provider ? { provider: call.provider } : {})
    }
    const estimatedUsd = estimateCostUsd(usage, nowMs)
    recovered.set(call.id, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      requests: seen.size,
      ...(model ? { model } : {}),
      ...(estimatedUsd !== undefined ? { estimatedUsd } : {}),
      transcript: path
    })
  }
  return recovered
}
