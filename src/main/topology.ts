// Topologie CANONIQUE d'agents — le modèle mental réel d'Autowin OS.
//
//   skill → invocation de sous-agent → modèle affecté
//
// Objets manipulés = les MODÈLES IMPORTÉS (models.ts). La topologie est
// versionnée, persistée côté main (autorité durable = main, pas le renderer) :
//   - exactement 1 slot orchestrator ;
//   - 0..N slots subagents ;
//   - panels.scout/frame/terrain 0..N slots exécutés EN PARALLÈLE ;
//   - panels.judge 0..N slots exécutés EN PARALLÈLE ;
//   - chaque binding atomique = provider + model + effort.
// Aucun axe « métier / persona ».

import { isReasoningEffort, type ReasoningEffort } from './roles'
import { defaultModelForProvider, findModel, type ImportedModel } from './models'
import { parseComputeBinding, type ComputeBinding } from '../shared/compute-fabric'
import { ROUTED_PROVIDERS, type RoutedProvider } from './routed-providers'

/** Version du schéma de topologie persistée (migration sûre à l'ouverture). */
const TOPOLOGY_VERSION = 1

/** Un binding atomique : un slot lié à un modèle importé + un effort. */
export interface SlotBinding {
  /** Identité stable du slot dans sa cible (distincte de l'exécution). */
  slotId: string
  /** Provider résolu (redondant avec le modèle, mais figé au moment du binding). */
  provider: string
  /** Référence à ImportedModel.id. */
  modelId: string
  /** Effort de raisonnement (∈ ImportedModel.reasoningEfforts). */
  reasoningEffort: ReasoningEffort
  /** Pin cryptographique et politique d'une ressource distante. */
  compute?: ComputeBinding
}

/** Les cibles panel de la topologie (0..N slots, exécutés en parallèle). Orchestrateur = singleton. */
export type PanelTarget = 'scout' | 'frame' | 'terrain' | 'judge'
export type SlotTarget = 'orchestrator' | 'subagents' | PanelTarget

export interface AgentTopology {
  version: number
  /** Exactement 1. */
  orchestrator: SlotBinding
  /** 0..N. */
  subagents: SlotBinding[]
  /** 0..N chacun, exécutés en parallèle. */
  panels: {
    scout: SlotBinding[]
    frame: SlotBinding[]
    terrain: SlotBinding[]
    judge: SlotBinding[]
  }
}

/** Valide un binding contre le catalogue de modèles importés. Jette si incohérent. */
function assertBinding(binding: SlotBinding, models: ImportedModel[]): SlotBinding {
  assertBindingShape(binding)
  const model = findModel(models, binding.modelId)
  if (!model) throw new Error(`Modèle inconnu : ${binding.modelId}`)
  if (model.provider !== binding.provider) {
    throw new Error(
      `Provider incohérent pour ${binding.modelId} : binding=${binding.provider}, modèle=${model.provider}`
    )
  }
  if (!model.reasoningEfforts.includes(binding.reasoningEffort)) {
    throw new Error(
      `Effort « ${binding.reasoningEffort} » non supporté par ${binding.modelId} (attendu : ${model.reasoningEfforts.join('|')})`
    )
  }
  if (model.compute) {
    if (!binding.compute) throw new Error(`Binding Fabric incomplet pour ${binding.modelId}`)
    const compute = parseComputeBinding(binding.compute)
    if (JSON.stringify(compute) !== JSON.stringify(model.compute)) {
      throw new Error(`Binding Fabric périmé ou incohérent pour ${binding.modelId}`)
    }
  } else if (binding.compute) {
    throw new Error(`Binding Fabric interdit pour le modèle local ${binding.modelId}`)
  }
  return binding
}

function assertBindingShape(value: unknown): asserts value is SlotBinding {
  if (!value || typeof value !== 'object') throw new Error('Binding de slot invalide')
  const binding = value as Partial<SlotBinding>
  if (typeof binding.slotId !== 'string' || !binding.slotId.trim()) {
    throw new Error('Slot sans identité')
  }
  if (typeof binding.provider !== 'string' || !binding.provider.trim()) {
    throw new Error(`Provider absent pour ${binding.slotId}`)
  }
  if (typeof binding.modelId !== 'string' || !binding.modelId.trim()) {
    throw new Error(`Modèle absent pour ${binding.slotId}`)
  }
  if (!isReasoningEffort(binding.reasoningEffort)) {
    throw new Error(`Effort invalide pour ${binding.slotId}`)
  }
  if (binding.compute) {
    const compute = parseComputeBinding(binding.compute)
    const expectedProvider = `fabric:${compute.nodeId}:${compute.resourceId}`
    const expectedModelId = `fabric/${compute.nodeId}/${compute.resourceId}`
    if (binding.provider !== expectedProvider || binding.modelId !== expectedModelId) {
      throw new Error(`Identité Fabric incohérente pour ${binding.slotId}`)
    }
  } else if (!binding.modelId.startsWith(`${binding.provider}/`)) {
    throw new Error(`Identité de modèle incohérente pour ${binding.slotId}`)
  }
}

/**
 * Valide la structure persistée sans exiger que le catalogue dynamique soit disponible.
 * Un démarrage hors ligne ne doit jamais transformer une sélection utilisateur valide en
 * topologie par défaut Kimi/Gemini simplement parce que Codex/Claude n'a pas encore répondu.
 */
function assertTopologyShape(value: unknown): AgentTopology {
  if (!value || typeof value !== 'object') throw new Error('Topologie invalide')
  const topology = value as Partial<AgentTopology>
  if (!Number.isInteger(topology.version) || topology.version! < 1) {
    throw new Error('Version de topologie invalide')
  }
  assertBindingShape(topology.orchestrator)
  if (!topology.panels || typeof topology.panels !== 'object') {
    throw new Error('Panels de topologie invalides')
  }
  const groups: Array<[string, unknown]> = [
    ['subagents', topology.subagents],
    ['scout', topology.panels.scout],
    ['frame', topology.panels.frame],
    ['terrain', topology.panels.terrain],
    ['judge', topology.panels.judge]
  ]
  for (const [name, candidate] of groups) {
    if (!Array.isArray(candidate)) throw new Error(`Cible « ${name} » : tableau attendu`)
    if (candidate.length > 16) throw new Error(`Cible « ${name} » : 16 slots maximum`)
    const seen = new Set<string>()
    for (const slot of candidate) {
      assertBindingShape(slot)
      if (seen.has(slot.slotId))
        throw new Error(`slotId dupliqué dans « ${name} » : ${slot.slotId}`)
      seen.add(slot.slotId)
    }
  }
  return topology as AgentTopology
}

/** Valide entièrement les modèles déjà connus et tolère seulement ceux non encore découverts. */
export function assertTopologyAgainstAvailableModels(
  value: unknown,
  models: ImportedModel[]
): AgentTopology {
  const topology = assertTopologyShape(value)
  const bindings = [
    topology.orchestrator,
    ...topology.subagents,
    ...topology.panels.scout,
    ...topology.panels.frame,
    ...topology.panels.terrain,
    ...topology.panels.judge
  ]
  for (const binding of bindings) {
    if (findModel(models, binding.modelId)) assertBinding(binding, models)
  }
  return topology
}

/** Construit un binding par défaut pour un modèle donné (effort = défaut du modèle). */
export function bindingForModel(slotId: string, model: ImportedModel): SlotBinding {
  return {
    slotId,
    provider: model.provider,
    modelId: model.id,
    reasoningEffort: model.defaultReasoningEffort,
    ...(model.compute ? { compute: structuredClone(model.compute) } : {})
  }
}

/**
 * Valide une topologie entière contre le catalogue. Jette au premier problème :
 * orchestrateur présent + unique, chaque binding cohérent, slotId uniques par cible.
 */
export function assertTopology(topology: AgentTopology, models: ImportedModel[]): AgentTopology {
  const validated = assertTopologyShape(topology)
  assertBinding(validated.orchestrator, models)
  const groups: Array<[string, SlotBinding[]]> = [
    ['subagents', validated.subagents],
    ['scout', validated.panels.scout],
    ['frame', validated.panels.frame],
    ['terrain', validated.panels.terrain],
    ['judge', validated.panels.judge]
  ]
  for (const [, slots] of groups) {
    for (const slot of slots) {
      assertBinding(slot, models)
    }
  }
  return validated
}

/** Retourne le tableau de bindings d'une cible panel/subagents. */
function panelOf(topology: AgentTopology, target: PanelTarget | 'subagents'): SlotBinding[] {
  if (target === 'subagents') return topology.subagents
  return topology.panels[target]
}

/**
 * Pose (crée OU remplace) un binding.
 * - orchestrateur : remplace le singleton (le drop crée/remplace).
 * - subagents/scout/judge : si `slotId` existe déjà → remplace ; sinon → ajoute.
 * Immuable ; valide le binding contre le catalogue.
 */
export function setSlot(
  topology: AgentTopology,
  target: SlotTarget,
  binding: SlotBinding,
  models: ImportedModel[]
): AgentTopology {
  assertBinding(binding, models)
  if (target === 'orchestrator') {
    return { ...topology, orchestrator: { ...binding } }
  }
  const current = panelOf(topology, target)
  const index = current.findIndex((slot) => slot.slotId === binding.slotId)
  const next =
    index === -1
      ? [...current, { ...binding }]
      : current.map((s, i) => (i === index ? { ...binding } : s))
  if (target === 'subagents') return { ...topology, subagents: next }
  return { ...topology, panels: { ...topology.panels, [target]: next } }
}

/**
 * Migration de FORME à l'ouverture : backfill les cibles panel absentes des fichiers
 * antérieurs (ex. `frame`, ajouté après coup) à `[]`, AVANT toute validation. Sans ça,
 * `assertTopology` jetterait sur un `panels.frame` undefined et réinitialiserait toute la
 * config utilisateur. Idempotent et PUR : retourne un nouvel objet, ne mute pas l'argument.
 */
export function migrateTopologyShape(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const t = raw as { panels?: Record<string, unknown>; subagents?: unknown; orchestrator?: unknown }
  if (!t.panels || typeof t.panels !== 'object') return raw
  // Clone superficiel + panels cloné : aucune mutation de l'objet reçu (une référence externe
  // à `raw`/`raw.panels` conservée par l'appelant reste intacte).
  const panels = { ...(t.panels as Record<string, unknown>) }
  for (const target of ['scout', 'frame', 'terrain', 'judge'] as const) {
    if (!Array.isArray(panels[target])) panels[target] = []
  }
  for (const target of ['scout', 'frame', 'terrain', 'judge'] as const) {
    panels[target] = (panels[target] as unknown[]).map((slot) =>
      rebindSlotIfRetired(slot, t.orchestrator)
    )
  }
  const subagents = Array.isArray(t.subagents)
    ? t.subagents.map((slot) => rebindSlotIfRetired(slot, t.orchestrator))
    : t.subagents
  return { ...t, subagents, panels }
}

/**
 * Rebranche un slot resté sur un moteur RETIRÉ (Codex, Kimi, Gemini) vers le moteur de
 * l'orchestrateur, qui lui est vivant. On garde le `slotId` — donc le rôle configuré par
 * l'utilisateur survit ; seul le moteur mort est remplacé.
 *
 * Sans ça, `assertTopologyAgainstAvailableModels` rejette la topologie enregistrée et TOUTE la
 * configuration de l'utilisateur repart de zéro. Si l'orchestrateur lui-même est sur un moteur
 * retiré, on ne peut rien déduire ici : le slot est laissé tel quel et la validation tranchera.
 */
function rebindSlotIfRetired(slot: unknown, orchestrator: unknown): unknown {
  if (!slot || typeof slot !== 'object') return slot
  const provider = (slot as { provider?: unknown }).provider
  if (typeof provider !== 'string') return slot
  if (ROUTED_PROVIDERS.includes(provider as RoutedProvider)) return slot
  const cible = orchestrator as { provider?: unknown; modelId?: unknown } | undefined
  if (!cible || typeof cible.provider !== 'string' || typeof cible.modelId !== 'string') return slot
  if (!ROUTED_PROVIDERS.includes(cible.provider as RoutedProvider)) return slot
  return { ...(slot as object), provider: cible.provider, modelId: cible.modelId }
}

/**
 * Topologie par défaut RAISONNABLE, bornée au catalogue fourni : tous les rôles
 * sur Claude, chacun sur le premier modèle importé de son provider (jamais
 * inventé). Le scout était sur Codex jusqu'au retrait des moteurs abandonnés
 * (Codex/Kimi/Gemini) : il bascule sur Claude comme les autres rôles.
 */
export function createDefaultTopology(models: ImportedModel[]): AgentTopology {
  if (models.length === 0) throw new Error('Impossible de créer une topologie sans modèle importé')
  const claude = defaultModelForProvider(models, 'claude')
  const orchestratorModel = claude ?? models[0]
  const subagentModel = claude ?? models[0]
  const scoutModel = claude ?? models[0]
  const judgeModel = claude ?? models[0]
  const frameModel = claude ?? models[0]
  const terrainModel = claude ?? models[0]
  return {
    version: TOPOLOGY_VERSION,
    orchestrator: bindingForModel('orchestrator', orchestratorModel),
    subagents: [bindingForModel('subagent-1', subagentModel)],
    panels: {
      scout: [bindingForModel('scout-1', scoutModel)],
      frame: [bindingForModel('frame-1', frameModel)],
      terrain: [bindingForModel('terrain-1', terrainModel)],
      judge: [bindingForModel('judge-1', judgeModel)]
    }
  }
}
