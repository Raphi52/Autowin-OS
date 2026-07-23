import {
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnStatus,
  type PersistedChatActionPart,
  type PersistedChatPart,
  type PersistedChatTextPart
} from '../../../shared/chat-turn'

export type ChatActionPart = PersistedChatActionPart
export type ChatTextPart = PersistedChatTextPart
export type ChatPart = PersistedChatPart
export type ChatActivityBlock = { kind: 'activity'; actions: ChatActionPart[] }
export type ChatRenderBlock = ChatTextPart | ChatActivityBlock

export interface HydratedAssistantMessage {
  role: 'assistant'
  turnId?: string
  parts: ChatPart[]
  status: ChatTurnStatus
  done: boolean
  error?: string
}

export interface StoredAssistantMessage {
  content: string
  turnId?: string
  parts?: ChatPart[]
  status?: ChatTurnStatus
  error?: string
}

export type ConversationStateKey =
  'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'waiting' | 'empty'

export interface ConversationState {
  key: ConversationStateKey
  label: string
  detail: string
  glyph: string
}

export function deriveConversationState(input: {
  busy: boolean
  messageCount: number
  lastMessageRole?: 'user' | 'assistant'
  lastAssistantStatus?: ChatTurnStatus
}): ConversationState {
  if (input.busy || input.lastAssistantStatus === 'streaming') {
    return {
      key: 'running',
      label: 'En cours',
      detail: 'Réponse en cours de génération',
      glyph: ''
    }
  }
  if (input.lastMessageRole === 'user') {
    return {
      key: 'waiting',
      label: 'Sans réponse',
      detail: 'Le dernier message utilisateur est sans réponse',
      glyph: '·'
    }
  }
  if (input.lastAssistantStatus === 'failed') {
    return { key: 'failed', label: 'Erreur', detail: 'Le dernier tour a échoué', glyph: '!' }
  }
  if (input.lastAssistantStatus === 'interrupted') {
    return {
      key: 'interrupted',
      label: 'Interrompue',
      detail: 'Le dernier tour a été interrompu',
      glyph: 'Ⅱ'
    }
  }
  if (input.lastAssistantStatus === 'cancelled') {
    return {
      key: 'cancelled',
      label: 'Arrêtée',
      detail: 'Le dernier tour a été arrêté',
      glyph: '×'
    }
  }
  if (input.lastAssistantStatus === 'completed') {
    return { key: 'completed', label: 'À jour', detail: 'Le dernier tour est terminé', glyph: '✓' }
  }
  if (input.messageCount === 0) {
    return { key: 'empty', label: 'Vide', detail: 'Aucun message', glyph: '○' }
  }
  return {
    key: 'waiting',
    label: 'Sans réponse',
    detail: 'Le dernier message utilisateur est sans réponse',
    glyph: '·'
  }
}

export interface AssistantPilotEvent {
  turnId?: string
  kind:
    | 'delta'
    | 'stream-reset'
    | 'think'
    | 'command'
    | 'result'
    | 'done'
    | 'error'
    | 'retry'
    | 'cancellation'
  streamId?: string
  actionId?: string
  iteration?: number
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

export function hydrateStoredAssistant(message: StoredAssistantMessage): HydratedAssistantMessage {
  const status = message.status ?? 'completed'
  return {
    role: 'assistant',
    ...(message.turnId ? { turnId: message.turnId } : {}),
    parts:
      message.parts?.map((part) => ({ ...part })) ??
      (message.content ? [{ kind: 'text', text: message.content }] : []),
    status,
    done: status !== 'streaming',
    ...(message.error ? { error: message.error } : {})
  }
}

export function reduceAssistantPilotEvent(
  message: HydratedAssistantMessage,
  event: AssistantPilotEvent
): HydratedAssistantMessage {
  if (message.done && !message.turnId) return message
  if (message.turnId && event.turnId && message.turnId !== event.turnId) return message
  const turnId = message.turnId ?? event.turnId ?? 'pending'
  let turnEvent: ChatTurnEvent | undefined
  if (event.kind === 'delta' && event.text && event.streamId)
    turnEvent = { kind: 'delta', streamId: event.streamId, text: event.text }
  else if (event.kind === 'stream-reset' && event.streamId)
    turnEvent = { kind: 'stream-reset', streamId: event.streamId }
  else if (event.kind === 'think' && event.text)
    turnEvent = {
      kind: 'delta',
      streamId: `fallback:${event.iteration ?? 0}`,
      text: event.text
    }
  else if (event.kind === 'command' && event.name)
    turnEvent = {
      kind: 'command',
      actionId: event.actionId ?? `action:${message.parts.length}`,
      name: event.name,
      args: event.args
    }
  else if (event.kind === 'result' && event.name) {
    const matching = [...message.parts]
      .reverse()
      .find(
        (part) =>
          part.kind === 'action' &&
          part.name === event.name &&
          (event.actionId ? part.actionId === event.actionId : part.ok === undefined)
      )
    turnEvent = {
      kind: 'result',
      actionId:
        event.actionId ??
        (matching?.kind === 'action' ? matching.actionId : undefined) ??
        `action:${message.parts.length}`,
      name: event.name,
      ok: event.ok,
      data: event.data
    }
  } else if (event.kind === 'done') turnEvent = { kind: 'done' }
  else if (event.kind === 'error')
    turnEvent = { kind: 'failed', error: event.text ?? 'Erreur inconnue' }
  else if (event.kind === 'cancellation') turnEvent = { kind: 'cancelled' }
  if (!turnEvent) return message

  const next = reduceChatTurn(
    {
      turnId,
      status: message.status,
      parts: message.parts,
      ...(message.error ? { error: message.error } : {})
    },
    turnEvent
  )
  return {
    role: 'assistant',
    turnId,
    parts: next.parts,
    status: next.status,
    done: next.status !== 'streaming',
    ...(next.error ? { error: next.error } : {})
  }
}

interface RuntimeSlot {
  slotId?: string
  provider: string
  modelId: string
  reasoningEffort: string
}

interface RuntimeTopology {
  orchestrator: RuntimeSlot
}

export interface RuntimeModel {
  id: string
  provider: string
  model: string
  label?: string
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
}

/** Une étape d'orchestration (sous-agent / juge / gate) — fil des sous-agents. */
export type OrchStep = {
  step: 'exec' | 'judge' | 'gate' | string
  provider?: string
  role?: string
  /** Modèle concret du tour — distingue les N membres d'un fan-out (rendu côte à côte). */
  model?: string
  text?: string
  detail?: string
  costUsd?: number
  /** Statut du sous-agent — un échec doit se voir (sinon un step raté passe pour réussi). */
  status?: 'completed' | 'failed'
  /** Cause de l'échec (message), affichée quand status==='failed'. */
  error?: string
  /** Raisonnement/thinking du sous-agent, conservé pour post-mortem (rendu repliable). */
  thinking?: string
  prompt?: {
    provider: string
    model?: string
    transport: string
    system?: string
    messages: Array<{ role: string; content: string }>
    options: Record<string, unknown>
    limitation: string
  }
  /** Preuves d'exécution du tour (diff fichiers, stdout/exit commandes) — rendues inline. */
  evidence?: EvidencePart[]
}

/** Preuve d'exécution telle qu'affichée dans le Chat (miroir renderer de ExecutionEvidence). */
export type EvidencePart = {
  type: string
  kind: string
  ok: boolean
  summary: string
  command?: string
  exitCode?: number
  stdout?: string
  diff?: string
  path?: string
}

/** Un groupe de rendu : soit un step seul, soit un run de membres d'un même fan-out (à comparer). */
export type StepGroup =
  | { kind: 'single'; step: OrchStep }
  | { kind: 'fanout'; key: string; steps: OrchStep[] }

/**
 * Clé de membre de fan-out : un step porteur d'un `model`, rattaché à sa phase (ou au juge).
 * INVARIANT appelant (orchestrator.ts) : deux rounds de fan-out juge consécutifs sont TOUJOURS
 * séparés par un step `gate` (clé nulle) → la clé constante 'judge' ne fusionne jamais deux rounds.
 * Si cet invariant changeait, ajouter un désambiguateur de round à la clé juge.
 */
function fanoutMemberKey(s: OrchStep): string | null {
  if (!s.model) return null // les steps mono (sans model) et synthèse/gate ne groupent pas
  const phase = s.detail?.match(/phase (\w+)/)?.[1]
  if (phase) return `${s.role ?? ''}:${phase}`
  if (s.role === 'judge') return 'judge'
  return null
}

/**
 * Regroupe les membres CONSÉCUTIFS d'un même fan-out (≥2, même clé) pour un rendu côte à côte ;
 * tout le reste (mono, synthèse, gate) reste un step seul. Pur → testable. La synthèse (rôle
 * orchestrateur, clé nulle) sépare naturellement deux phases fan-outées successives.
 */
export function groupSubagentSteps(steps: OrchStep[]): StepGroup[] {
  const out: StepGroup[] = []
  let run: { key: string; steps: OrchStep[] } | null = null
  const flush = (): void => {
    if (!run) return
    if (run.steps.length >= 2) out.push({ kind: 'fanout', key: run.key, steps: run.steps })
    else out.push({ kind: 'single', step: run.steps[0] })
    run = null
  }
  for (const s of steps) {
    const key = fanoutMemberKey(s)
    if (key && run && run.key === key) {
      run.steps.push(s)
      continue
    }
    flush()
    if (key) run = { key, steps: [s] }
    else out.push({ kind: 'single', step: s })
  }
  flush()
  return out
}

/** Icône + libellé par type d'étape d'orchestration (affichage temps réel). */
export const STEP_META: Record<string, { icon: string; label: string }> = {
  exec: { icon: '🤖', label: 'sous-agent' },
  judge: { icon: '⚖️', label: 'juge' },
  gate: { icon: '🚦', label: 'gate' }
}

export interface OrchestratorModelOption {
  provider: string
  model: string
  label: string
  reasoningEfforts: string[]
  defaultReasoningEffort?: string
  reasoningEffort?: string
}

export interface OrchestratorModelGroup {
  /** Clé stable de la catégorie éditeur (anthropic, openai, google…). */
  key: string
  /** Libellé d'en-tête affiché (Anthropic, ChatGPT, Google…). */
  label: string
  options: OrchestratorModelOption[]
}

/**
 * Catégorie ÉDITEUR déduite de l'id du modèle. Ordre voulu :
 * Anthropic, puis ChatGPT, puis les autres éditeurs (alpha), puis routes auto, puis divers.
 */
export function modelVendor(model: string): { key: string; label: string; rank: number } {
  const id = model.toLowerCase()
  // Les routes auto/* forment LEUR PROPRE catégorie (jamais mélangées à un éditeur),
  // testées AVANT la marque pour que `auto/claude-opus` n'atterrisse pas dans Anthropic.
  const isAuto = id.startsWith('auto') || id.startsWith('custom:') || id.includes('/auto')
  if (isAuto) return { key: 'auto', label: 'Sélection automatique', rank: 8 }
  if (id.includes('claude')) return { key: 'anthropic', label: 'Anthropic', rank: 0 }
  if (/gpt|codex|\bo\d/.test(id)) return { key: 'openai', label: 'ChatGPT', rank: 1 }
  if (id.includes('gemini') || id.includes('gemma'))
    return { key: 'google', label: 'Google', rank: 2 }
  if (id.includes('kimi')) return { key: 'moonshot', label: 'Kimi (Moonshot)', rank: 2 }
  if (id.includes('mimo') || id.includes('xiaomi'))
    return { key: 'xiaomi', label: 'Xiaomi', rank: 2 }
  if (id.includes('glm') || id.includes('zai') || id.includes('z-ai'))
    return { key: 'zai', label: 'Z.ai', rank: 2 }
  if (id.includes('llama')) return { key: 'meta', label: 'Meta (Llama)', rank: 2 }
  if (id.includes('qwen')) return { key: 'qwen', label: 'Qwen', rank: 2 }
  if (id.includes('grok')) return { key: 'xai', label: 'xAI (Grok)', rank: 2 }
  if (id.includes('deepseek')) return { key: 'deepseek', label: 'DeepSeek', rank: 2 }
  if (id.includes('mistral')) return { key: 'mistral', label: 'Mistral', rank: 2 }
  return { key: 'other', label: 'Autres', rank: 9 }
}

/**
 * Clé de tri d'un modèle CONCRET dans sa catégorie éditeur : famille puis version,
 * du plus capable/récent au plus ancien. Ex. Opus 4.8 avant Opus 4.5 avant Sonnet.
 */
export function modelRecencyKey(model: string): [number, number] {
  const id = model.toLowerCase()
  const family = id.includes('fable')
    ? 5
    : id.includes('opus')
      ? 4
      : id.includes('sonnet')
        ? 3
        : id.includes('haiku')
          ? 2
          : 0
  const version = /(\d+)[._-](\d+)/.exec(id)
  const versionScore = version
    ? Number(version[1]) * 100 + Number(version[2])
    : /(\d+)/.test(id)
      ? Number(/(\d+)/.exec(id)![1]) * 100
      : 0
  return [family, versionScore]
}

/** Seuils de coût-équivalent par tour (dérivés de 78k tours réels : p33/p66). */
export const COST_EQ_LOW = 18_000
export const COST_EQ_HIGH = 47_000

/** Coût-équivalent tokens d'un tour (output ×5, input ×1). */
export function turnCostEq(usage: { inputTokens?: number; outputTokens?: number } | null): number {
  if (!usage) return 0
  return (usage.inputTokens ?? 0) + 5 * (usage.outputTokens ?? 0)
}

/** Palier de coût du DERNIER tour (pastille live) — vert/orange/rouge selon les seuils réels. */
export function costEqTier(costEq: number): { dotClass: string; label: string } {
  const k = Math.round(costEq / 1000)
  if (costEq < COST_EQ_LOW) return { dotClass: 'st-ok', label: `Dernier tour léger (~${k}k)` }
  if (costEq < COST_EQ_HIGH) return { dotClass: 'st-warn', label: `Dernier tour moyen (~${k}k)` }
  return { dotClass: 'st-err', label: `Dernier tour lourd (~${k}k)` }
}

/**
 * Palier de prix d'un modèle (pastille coût du Chat), déduit de l'id.
 * vert = pas cher · orange = moyen · rouge = cher · gris = inconnu (auto/*, non classé).
 * Heuristique par famille — un coût $/token LIVE pourra l'affiner plus tard.
 */
export function modelCostTier(model: string): {
  tier: 'low' | 'mid' | 'high' | 'unknown'
  dotClass: string
  label: string
} {
  const id = model.toLowerCase()
  const isAuto = id.startsWith('auto') || id.startsWith('custom:') || id.includes('/auto')
  if (isAuto)
    return { tier: 'unknown', dotClass: 'st-neutral', label: 'Coût variable (route auto)' }
  if (/opus|gpt-5\.\d+-pro|grok-\d+-reasoning/.test(id))
    return { tier: 'high', dotClass: 'st-err', label: 'Modèle cher' }
  if (/haiku|flash|mini|nano|lite|small|8b|7b|scout/.test(id))
    return { tier: 'low', dotClass: 'st-ok', label: 'Modèle pas cher' }
  if (/sonnet|gpt-5|gemini-\d|glm|mimo|qwen|deepseek|llama|kimi|fable/.test(id))
    return { tier: 'mid', dotClass: 'st-warn', label: 'Coût moyen' }
  return { tier: 'unknown', dotClass: 'st-neutral', label: 'Coût inconnu' }
}

/**
 * Sous-tri des routes auto/* du bucket « Sélection automatique » (le regroupement par
 * éditeur est fait en amont par modelVendor). Ordre : Chat → Raisonnement → Code → reste,
 * tier « best » avant « pro ». Retourne [sous-rang, 0] ; libellé puis index tranchent les égalités.
 */
export function orchestratorOptionRank(model: string): [number, number] {
  const id = model.toLowerCase()
  const dimension = id.includes('chat') ? 0 : id.includes('reason') ? 1 : id.includes('cod') ? 2 : 3
  const tier = id.includes('best') ? 0 : id.includes('pro') ? 1 : 2
  return [dimension * 10 + tier, 0]
}

export function buildOrchestratorModelGroups(
  models: RuntimeModel[],
  current?: { provider: string; model?: string }
): {
  groups: OrchestratorModelGroup[]
  currentMissing?: OrchestratorModelOption
} {
  // Regroupement par ÉDITEUR (pas par le provider technique).
  const byVendor = new Map<
    string,
    { label: string; rank: number; options: OrchestratorModelOption[] }
  >()
  for (const item of models) {
    // Bruit masqué : les variantes « Sans raisonnement » (no-think/*) n'encombrent plus le menu.
    if (/(^|\/)no-think\//i.test(item.model)) continue
    const option = {
      provider: item.provider,
      model: item.model,
      label: item.label?.trim() || item.model,
      reasoningEfforts: item.reasoningEfforts ?? ['none'],
      defaultReasoningEffort: item.defaultReasoningEffort
    }
    const vendor = modelVendor(item.model)
    const bucket = byVendor.get(vendor.key) ?? {
      label: vendor.label,
      rank: vendor.rank,
      options: []
    }
    if (!bucket.options.some((entry) => entry.model === option.model)) bucket.options.push(option)
    byVendor.set(vendor.key, bucket)
  }
  // Éditeurs : plus récent/capable d'abord (Opus 4.8 → 4.7 …). Auto : sous-tri Chat/Code conservé.
  const sortOptions = (
    key: string,
    options: OrchestratorModelOption[]
  ): OrchestratorModelOption[] =>
    options
      .map((option, index) => ({ option, index }))
      .sort((a, b) => {
        if (key === 'auto') {
          const ra = orchestratorOptionRank(a.option.model)
          const rb = orchestratorOptionRank(b.option.model)
          return (
            ra[0] - rb[0] ||
            ra[1] - rb[1] ||
            a.option.label.localeCompare(b.option.label, 'fr', { numeric: true }) ||
            a.index - b.index
          )
        }
        const ka = modelRecencyKey(a.option.model)
        const kb = modelRecencyKey(b.option.model)
        return (
          kb[0] - ka[0] || // famille décroissante (Opus > Sonnet > Haiku)
          kb[1] - ka[1] || // version décroissante (4.8 > 4.7)
          a.option.label.localeCompare(b.option.label, 'fr', { numeric: true }) ||
          a.index - b.index
        )
      })
      .map(({ option }) => option)
  const groups = [...byVendor.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      rank: bucket.rank,
      options: sortOptions(key, bucket.options)
    }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'fr'))
    .map(({ key, label, options }) => ({ key, label, options }))
  const currentModel = current?.model
  const currentExists =
    currentModel !== undefined &&
    models.some(
      (item) =>
        item.provider === current?.provider &&
        (item.model === currentModel || item.id === currentModel)
    )
  return {
    groups,
    ...(!currentExists && current && currentModel
      ? {
          currentMissing: {
            provider: current.provider,
            model: currentModel,
            label: `${current.provider} · ${currentModel} (indisponible)`,
            reasoningEfforts: []
          }
        }
      : {})
  }
}

interface RuntimeRoleBinding {
  provider: string
  model?: string
  reasoningEffort?: string
}

export interface ChatRuntimeIdentity {
  provider: string
  model: string
  modelLabel: string
  reasoningEffort: string
}

/** Phase en cours d'exécution (avant que l'étape ne soit enregistrée) — avancement live. */
export interface LiveRunPhase {
  step: string
  provider?: string
  role?: string
  model?: string
  reasoningEffort?: string
  /** A4 — phase pipeline (scout/frame/…) pour un libellé live précis. */
  phase?: string
}

/** Libellé lisible d'une phase de pipeline (A4) — sinon retombe sur le libellé d'étape. */
export function phaseLabel(p: { step: string; phase?: string }): string {
  const PHASE_FR: Record<string, string> = {
    scout: 'scout',
    frame: 'cadrage',
    terrain: 'terrain',
    build: 'build',
    clean: 'nettoyage',
    judge: 'juge'
  }
  if (p.phase && PHASE_FR[p.phase]) return `sous-agent · ${PHASE_FR[p.phase]}`
  return STEP_META[p.step]?.label ?? p.step
}

export interface ScopedLiveRun<TStep = unknown> {
  convId: string
  runPath?: string
  task: string
  steps: TStep[]
  status: 'running' | 'green' | 'red'
  /** Phase active (sous-agent/juge/gate) tant qu'elle n'a pas produit son étape. */
  phase?: LiveRunPhase
  /** Texte streamé de la phase en cours (réinitialisé à chaque nouvelle phase/étape). */
  liveText?: string
}

export type ScopedLiveRunEvent<TStep = unknown> =
  | { type: 'start'; convId: string; runPath?: string; task: string }
  | { type: 'phase'; convId: string; runPath?: string; phase: LiveRunPhase }
  | { type: 'delta'; convId: string; runPath?: string; delta: string }
  | { type: 'step'; convId: string; runPath?: string; step: TStep }
  | { type: 'end'; convId: string; runPath?: string; status: 'green' | 'red' }
  | { type: 'clear'; convId: string; runPath?: string }

export interface RunRequestIdentity {
  id: number
  scope: 'conv' | 'tous'
  convId: string | null
}

export const CHAT_PANE_LIMITS = {
  conversations: { min: 224, max: 480 },
  workflows: { min: 280, max: 760 }
} as const

export function resolveChatRuntimeIdentity(
  topology: RuntimeTopology,
  models: RuntimeModel[],
  role?: RuntimeRoleBinding
): ChatRuntimeIdentity {
  const slot = topology.orchestrator
  if (role) {
    const imported = role.model
      ? models.find(
          (model) =>
            model.provider === role.provider &&
            (model.id === role.model || model.model === role.model)
        )
      : undefined
    return {
      provider: role.provider,
      model: imported?.model ?? role.model ?? 'default',
      modelLabel: imported?.label?.trim() || role.model || `${role.provider} · modèle par défaut`,
      reasoningEffort: role.reasoningEffort ?? 'auto'
    }
  }
  const imported = models.find(
    (model) => model.id === slot.modelId && model.provider === slot.provider
  )
  return {
    provider: slot.provider,
    model: imported?.model ?? slot.modelId,
    modelLabel: imported?.label?.trim() || imported?.model || slot.modelId,
    reasoningEffort: slot.reasoningEffort
  }
}

export function stripAssistantThinking(text: string): string {
  let sanitized = text

  // Complete blocks, including multiline reasoning.
  sanitized = sanitized.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, '')
  // A remaining closing tag is orphaned: everything before it is hidden reasoning.
  while (/<\/think\s*>/i.test(sanitized)) {
    sanitized = sanitized.replace(/^[\s\S]*?<\/think\s*>/i, '')
  }
  // An opening tag without its closing tag is a reasoning block still streaming.
  sanitized = sanitized.replace(/<think(?:\s[^>]*)?>[\s\S]*$/gi, '')
  // Do not flash a tag while either boundary itself is arriving token by token.
  sanitized = sanitized.replace(/<t(?:h(?:i(?:n(?:k(?:\s[^>]*)?)?)?)?)?$/i, '')
  sanitized = sanitized.replace(/^[\s\S]*?<\/(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '')

  return sanitized
}

export function coalesceAssistantParts(parts: ChatPart[]): ChatPart[] {
  const compact: ChatPart[] = []
  let pendingText: string[] = []
  const flushText = (): void => {
    const text = stripAssistantThinking(pendingText.join('\n\n')).trim()
    if (text) compact.push({ kind: 'text', text })
    pendingText = []
  }
  for (const part of parts) {
    if (part.kind === 'action') {
      flushText()
      compact.push(part)
      continue
    }
    pendingText.push(part.text)
  }
  flushText()
  return compact
}

export function groupAssistantActivity(parts: ChatPart[]): ChatRenderBlock[] {
  const blocks: ChatRenderBlock[] = []
  for (const part of coalesceAssistantParts(parts)) {
    if (part.kind === 'text') {
      blocks.push(part)
      continue
    }
    const previous = blocks.at(-1)
    if (previous?.kind === 'activity') previous.actions.push(part)
    else blocks.push({ kind: 'activity', actions: [part] })
  }
  return blocks
}

export function isChatNearBottom(
  metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  threshold = 72
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

export function clampConversationPaneWidth(width: number): number {
  return Math.round(
    Math.min(
      CHAT_PANE_LIMITS.conversations.max,
      Math.max(CHAT_PANE_LIMITS.conversations.min, width)
    )
  )
}

export function reduceScopedLiveRuns<TStep>(
  current: Record<string, ScopedLiveRun<TStep>>,
  event: ScopedLiveRunEvent<TStep>
): Record<string, ScopedLiveRun<TStep>> {
  if (event.type === 'start') {
    return {
      ...current,
      [event.convId]: {
        convId: event.convId,
        runPath: event.runPath,
        task: event.task,
        steps: [],
        status: 'running'
      }
    }
  }

  const existing = current[event.convId]
  if (!existing || (event.runPath && existing.runPath && event.runPath !== existing.runPath)) {
    return current
  }
  if (event.type === 'phase') {
    // Nouvelle phase → on repart d'un texte streamé vierge.
    return { ...current, [event.convId]: { ...existing, phase: event.phase, liveText: '' } }
  }
  if (event.type === 'delta') {
    return {
      ...current,
      [event.convId]: { ...existing, liveText: (existing.liveText ?? '') + event.delta }
    }
  }
  if (event.type === 'step') {
    // L'étape est enregistrée → la phase active et son texte streamé sont terminés.
    return {
      ...current,
      [event.convId]: {
        ...existing,
        steps: [...existing.steps, event.step],
        phase: undefined,
        liveText: undefined
      }
    }
  }
  if (event.type === 'end') {
    return {
      ...current,
      [event.convId]: { ...existing, status: event.status, phase: undefined, liveText: undefined }
    }
  }
  const next = { ...current }
  delete next[event.convId]
  return next
}

export function isRunRequestCurrent(
  requested: RunRequestIdentity,
  current: RunRequestIdentity
): boolean {
  return (
    requested.id === current.id &&
    requested.scope === current.scope &&
    requested.convId === current.convId
  )
}
