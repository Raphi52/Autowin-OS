// Topologie CANONIQUE d'agents — le modèle mental réel d'Autowin OS.
//
//   skill → invocation de sous-agent → modèle affecté
//
// Objets manipulés = les MODÈLES IMPORTÉS (models.ts). La topologie est
// versionnée, persistée côté main (autorité durable = main, pas le renderer) :
//   - exactement 1 slot orchestrator ;
//   - 0..N slots subagents ;
//   - panels.scout 0..N slots exécutés EN PARALLÈLE ;
//   - panels.judge 0..N slots exécutés EN PARALLÈLE ;
//   - chaque binding atomique = provider + model + effort.
// Aucun axe « métier / persona ».

import type { ReasoningEffort } from './roles'
import { defaultModelForProvider, findModel, type ImportedModel } from './models'

/** Version du schéma de topologie persistée (migration sûre à l'ouverture). */
export const TOPOLOGY_VERSION = 1

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
}

/** Les quatre cibles de la topologie. Orchestrateur = singleton. */
export type PanelTarget = 'scout' | 'judge'
export type SlotTarget = 'orchestrator' | 'subagents' | PanelTarget

export interface AgentTopology {
  version: number
  /** Exactement 1. */
  orchestrator: SlotBinding
  /** 0..N. */
  subagents: SlotBinding[]
  /** 0..N chacun, exécutés en parallèle. */
  panels: { scout: SlotBinding[]; judge: SlotBinding[] }
}

/** Un binding résolu vers son transport (provider + model + effort concrets). */
export interface ResolvedSlot {
  slotId: string
  target: SlotTarget
  provider: string
  /** Identifiant de transport (ImportedModel.model), pas l'id canonique. */
  model: string
  reasoningEffort: ReasoningEffort
}

/** Valide un binding contre le catalogue de modèles importés. Jette si incohérent. */
export function assertBinding(binding: SlotBinding, models: ImportedModel[]): SlotBinding {
  if (typeof binding.slotId !== 'string' || !binding.slotId.trim()) {
    throw new Error('Slot sans identité')
  }
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
  return binding
}

/** Construit un binding par défaut pour un modèle donné (effort = défaut du modèle). */
export function bindingForModel(slotId: string, model: ImportedModel): SlotBinding {
  return {
    slotId,
    provider: model.provider,
    modelId: model.id,
    reasoningEffort: model.defaultReasoningEffort
  }
}

/**
 * Valide une topologie entière contre le catalogue. Jette au premier problème :
 * orchestrateur présent + unique, chaque binding cohérent, slotId uniques par cible.
 */
export function assertTopology(topology: AgentTopology, models: ImportedModel[]): AgentTopology {
  if (!topology.orchestrator) throw new Error('Topologie sans orchestrateur (exactement 1 requis)')
  assertBinding(topology.orchestrator, models)
  const groups: Array<[string, SlotBinding[]]> = [
    ['subagents', topology.subagents],
    ['scout', topology.panels.scout],
    ['judge', topology.panels.judge]
  ]
  for (const [name, slots] of groups) {
    if (!Array.isArray(slots)) throw new Error(`Cible « ${name} » : tableau attendu`)
    if (slots.length > 16) throw new Error(`Cible « ${name} » : 16 slots maximum`)
    const seen = new Set<string>()
    for (const slot of slots) {
      assertBinding(slot, models)
      if (seen.has(slot.slotId))
        throw new Error(`slotId dupliqué dans « ${name} » : ${slot.slotId}`)
      seen.add(slot.slotId)
    }
  }
  return topology
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
 * Retire un binding d'une cible LISTE (subagents/scout/judge). L'orchestrateur
 * ne peut pas être retiré (singleton obligatoire) → à remplacer, pas supprimer.
 */
export function removeSlot(
  topology: AgentTopology,
  target: PanelTarget | 'subagents',
  slotId: string
): AgentTopology {
  const current = panelOf(topology, target).filter((slot) => slot.slotId !== slotId)
  if (target === 'subagents') return { ...topology, subagents: current }
  return { ...topology, panels: { ...topology.panels, [target]: current } }
}

/** Résout toutes les cibles vers leur transport concret (provider/model/effort). */
export function resolveTopology(
  topology: AgentTopology,
  models: ImportedModel[]
): {
  orchestrator: ResolvedSlot
  subagents: ResolvedSlot[]
  scout: ResolvedSlot[]
  judge: ResolvedSlot[]
} {
  const resolve = (binding: SlotBinding, target: SlotTarget): ResolvedSlot => {
    const model = findModel(models, binding.modelId)
    if (!model) throw new Error(`Modèle inconnu à la résolution : ${binding.modelId}`)
    return {
      slotId: binding.slotId,
      target,
      provider: binding.provider,
      model: model.model,
      reasoningEffort: binding.reasoningEffort
    }
  }
  return {
    orchestrator: resolve(topology.orchestrator, 'orchestrator'),
    subagents: topology.subagents.map((b) => resolve(b, 'subagents')),
    scout: topology.panels.scout.map((b) => resolve(b, 'scout')),
    judge: topology.panels.judge.map((b) => resolve(b, 'judge'))
  }
}

/**
 * Topologie par défaut RAISONNABLE, bornée au catalogue fourni : orchestrateur
 * Claude, un sous-agent Claude, un scout Codex, un judge Claude — chacun sur le
 * premier modèle importé de son provider (jamais inventé). Si un provider n'a
 * aucun modèle importé, sa cible reste vide (sauf l'orchestrateur, obligatoire).
 */
export function createDefaultTopology(models: ImportedModel[]): AgentTopology {
  if (models.length === 0) throw new Error('Impossible de créer une topologie sans modèle importé')
  const claude = defaultModelForProvider(models, 'claude')
  const codex = defaultModelForProvider(models, 'codex')
  const orchestratorModel = claude ?? models[0]
  const subagentModel = claude ?? models[0]
  const scoutModel = codex ?? claude ?? models[0]
  const judgeModel = claude ?? models[0]
  return {
    version: TOPOLOGY_VERSION,
    orchestrator: bindingForModel('orchestrator', orchestratorModel),
    subagents: [bindingForModel('subagent-1', subagentModel)],
    panels: {
      scout: [bindingForModel('scout-1', scoutModel)],
      judge: [bindingForModel('judge-1', judgeModel)]
    }
  }
}
