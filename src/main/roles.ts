// Configuration du modele par role du pipeline autowin.
// Chaque role (orchestrator, subagent, judge, scout) est lie a un provider
// (claude, codex, ...) et optionnellement a un modele precis ; si le modele
// est absent, le provider utilise son modele par defaut.

import type { PipelinePhase } from './skill-pipeline'
import { isModelAlias, resolveModelAlias, type AliasCandidate } from './model-aliases'
import { DEFAULT_IMPORTED_MODELS } from './models'

export type Role = 'orchestrator' | 'subagent' | 'judge' | 'scout'

export const ALL_ROLES: Role[] = ['orchestrator', 'subagent', 'judge', 'scout']

export interface RoleBinding {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
  /**
   * Override de modèle PAR PHASE (proportionnalité coût/latence) : les phases d'analyse
   * (scout/frame/terrain) peuvent tourner sur un petit modèle rapide, build/juge sur le gros.
   * Générique : référence des modèles du provider ACTIF, jamais un id figé. Absent pour une phase
   * → on retombe sur `model`/`reasoningEffort` du binding (rétrocompat → 0 régression).
   *
   * NB : mécanisme MONO-modèle par phase, DISTINCT du fan-out multi-modèles (scout/frame/judge) qui
   * vit dans la topology (`AgentTopology.panels`) → `AutowinOS.fanOut`/`setFanOut` → deps orchestrateur
   * `phaseFanOut`/`judgeFanOut`. `phaseModel` n'est PAS consommé par le fan-out topology.
   */
  phaseModel?: Partial<Record<PipelinePhase, { model?: string; reasoningEffort?: ReasoningEffort }>>
}

/** Résout le (modèle, effort) EFFECTIF d'une phase pour un binding (override phase → défaut binding). */
export function resolvePhaseBinding(
  binding: RoleBinding,
  phase: PipelinePhase
): { model?: string; reasoningEffort?: ReasoningEffort } {
  const override = binding.phaseModel?.[phase]
  return {
    model: override?.model ?? binding.model,
    reasoningEffort: override?.reasoningEffort ?? binding.reasoningEffort
  }
}

// Défauts par provider en ALIAS stables (résolus au runtime contre le catalogue
// découvert) : un nouveau modèle plus récent est adopté sans toucher aux bindings.
const PROVIDER_DEFAULT_SELECTIONS: Record<
  string,
  { model: string; reasoningEffort: ReasoningEffort }
> = {
  claude: { model: 'fable-latest', reasoningEffort: 'high' },
  codex: { model: 'codex-latest', reasoningEffort: 'medium' },
  kimi: { model: 'kimi-latest', reasoningEffort: 'none' }
}

/**
 * Ids concrets historiquement écrits en dur dans les bindings → alias stable.
 * Sert à migrer les roles.json persistés AVANT l'introduction des alias.
 */
const LEGACY_MODEL_TO_ALIAS: Record<string, string> = {
  'claude-fable-5': 'fable-latest',
  'claude-opus-4-6': 'opus-latest',
  'claude-haiku-4-5-20251001': 'haiku-latest',
  'gpt-5.6-terra': 'codex-latest',
  'kimi-code/kimi-for-coding': 'kimi-latest'
}

function migrateModel(model: string | undefined): string | undefined {
  return model !== undefined ? (LEGACY_MODEL_TO_ALIAS[model] ?? model) : undefined
}

/**
 * Migration PURE des bindings persistés : remplace les ids concrets historiques
 * (défauts en dur d'avant les alias) par leur alias de famille. Un modèle épinglé
 * explicitement hors de cette table reste INTACT (choix utilisateur respecté).
 */
export function migrateRoleBindingsToAliases(
  bindings: Partial<Record<Role, RoleBinding>>
): Partial<Record<Role, RoleBinding>> {
  const migrated: Partial<Record<Role, RoleBinding>> = {}
  for (const role of ALL_ROLES) {
    const binding = bindings[role]
    if (!binding) continue
    const phaseModel = binding.phaseModel
      ? Object.fromEntries(
          Object.entries(binding.phaseModel).map(([phase, override]) => [
            phase,
            override ? { ...override, model: migrateModel(override.model) } : override
          ])
        )
      : undefined
    migrated[role] = {
      ...binding,
      model: migrateModel(binding.model),
      ...(phaseModel ? { phaseModel } : {})
    }
  }
  return migrated
}

/** Résout un modèle potentiellement alias vers l'id concret du catalogue (sinon inchangé). */
function resolveAliasedModel(catalog: AliasCandidate[], model: string | undefined): string | undefined {
  if (model === undefined || !isModelAlias(model)) return model
  return resolveModelAlias(catalog, model) ?? model
}

/** Retourne le binding avec ses alias (`model` + overrides par phase) résolus contre le catalogue. */
function resolveAliasedBinding(catalog: AliasCandidate[], binding: RoleBinding): RoleBinding {
  const phaseModel = binding.phaseModel
    ? Object.fromEntries(
        Object.entries(binding.phaseModel).map(([phase, override]) => [
          phase,
          override ? { ...override, model: resolveAliasedModel(catalog, override.model) } : override
        ])
      )
    : undefined
  return {
    ...binding,
    model: resolveAliasedModel(catalog, binding.model),
    ...(phaseModel ? { phaseModel } : {})
  }
}

/** Rend explicite ce que l'adaptateur utiliserait sinon implicitement. */
export function normalizeRoleBinding(binding: RoleBinding): RoleBinding {
  const defaults = PROVIDER_DEFAULT_SELECTIONS[binding.provider]
  if (!defaults) return { ...binding }
  return {
    ...binding,
    model: binding.model ?? defaults.model,
    reasoningEffort: binding.reasoningEffort ?? defaults.reasoningEffort
  }
}

/** Config par defaut raisonnable : claude pour l'essentiel, codex pour le scout. */
const DEFAULT_BINDINGS: Record<Role, RoleBinding> = {
  orchestrator: normalizeRoleBinding({ provider: 'claude' }),
  subagent: normalizeRoleBinding({ provider: 'claude' }),
  judge: normalizeRoleBinding({ provider: 'claude' }),
  scout: normalizeRoleBinding({ provider: 'codex' })
}

export class RoleModelConfig {
  private bindings: Record<Role, RoleBinding>
  // Catalogue de résolution des alias. Seed = modèles vérifiés hors ligne ;
  // remplacé par la liste DÉCOUVERTE via setModelCatalog() après le boot.
  private catalog: AliasCandidate[] = DEFAULT_IMPORTED_MODELS

  constructor(defaults?: Partial<Record<Role, RoleBinding>>) {
    // Fusion superficielle : chaque role explicitement fourni remplace entierement
    // le binding par defaut correspondant (pas de merge partiel provider/model).
    this.bindings = { ...DEFAULT_BINDINGS }
    if (defaults) {
      for (const role of ALL_ROLES) {
        const override = defaults[role]
        if (override) {
          this.bindings[role] = normalizeRoleBinding(override)
        }
      }
    }
  }

  getBinding(role: Role): RoleBinding {
    // Garde runtime defensive : le type Role empeche deja les valeurs invalides
    // a la compilation, mais on se protege d'un appel JS non type ou d'une
    // valeur corrompue a l'execution.
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    // Les alias sont résolus À LA LECTURE : les adaptateurs ne voient que des
    // ids concrets du catalogue ; le stockage (et la persistance via rawAll())
    // conserve l'alias stable.
    return resolveAliasedBinding(this.catalog, this.bindings[role])
  }

  /** Remplace le catalogue de résolution des alias (liste découverte au boot). */
  setModelCatalog(models: AliasCandidate[]): this {
    if (models.length > 0) this.catalog = models
    return this
  }

  setBinding(role: Role, b: RoleBinding): this {
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    this.bindings[role] = normalizeRoleBinding(b)
    return this
  }

  all(): Record<Role, RoleBinding> {
    return Object.fromEntries(
      ALL_ROLES.map((role) => [role, this.getBinding(role)])
    ) as Record<Role, RoleBinding>
  }

  /** Bindings BRUTS (alias non résolus) — pour la persistance disque uniquement. */
  rawAll(): Record<Role, RoleBinding> {
    return { ...this.bindings }
  }
}

/**
 * Effort de raisonnement d'un binding atomique. La liste est le SUR-ENSEMBLE
 * possible ; chaque modèle importé déclare le sous-ensemble qu'il supporte
 * réellement (cf. ImportedModel.reasoningEfforts) et chaque adaptateur rejette
 * explicitement une valeur qu'il ne sait pas transmettre (cf. providers/*).
 */
export type ReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
