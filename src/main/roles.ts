// Configuration du modele par role du pipeline autowin.
// Chaque role (orchestrator, subagent, judge, scout) est lie a un provider
// (claude, codex, ...) et optionnellement a un modele precis ; si le modele
// est absent, le provider utilise son modele par defaut.

import type { PipelinePhase } from './skill-pipeline'
import { resolveFamilyAlias } from './model-resolver'
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

// ————— Alias stables (`*-latest`) dans les bindings de rôles —————
//
// Un binding peut référencer un ALIAS de famille (`claude/opus-latest`,
// `codex/gpt-latest`) au lieu d'un id de transport figé. La résolution passe
// par `resolveAlias` du ModelResolver (model-resolver.ts), injecté au boot via
// `setRoleAliasResolver` ; avant injection (ou en test), on résout contre le
// seed vérifié. Un alias IRRÉSOLUBLE est renvoyé tel quel (rien d'inventé :
// l'adaptateur échouera VISIBLEMENT plutôt que sur un modèle deviné).

export type RoleAliasResolver = (alias: string) => string | undefined

let roleAliasResolver: RoleAliasResolver = (alias) =>
  resolveFamilyAlias(DEFAULT_IMPORTED_MODELS, alias)?.model

/** Injecte le résolveur dynamique (index.ts : `modelResolver.resolveAlias`). */
export function setRoleAliasResolver(resolver: RoleAliasResolver): void {
  roleAliasResolver = resolver
}

function isModelAlias(model: string): boolean {
  return /-latest$/.test(model)
}

/** Alias `*-latest` → id de transport courant ; id concret = pass-through. */
export function resolveBindingModel(model: string | undefined): string | undefined {
  if (model === undefined || !isModelAlias(model)) return model
  return roleAliasResolver(model) ?? model
}

/**
 * Migration des bindings hérités : un modèle Opus figé (`claude-opus-4-5`,
 * snapshot daté…) suit désormais l'alias de sa famille — le binding reste à
 * jour à chaque refresh du catalogue au lieu de pointer un id périmé.
 */
const LEGACY_MODEL_TO_ALIAS: Array<{ test: RegExp; alias: string }> = [
  { test: /^claude-opus-\d/, alias: 'claude/opus-latest' }
]

function migrateLegacyModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  return LEGACY_MODEL_TO_ALIAS.find((m) => m.test.test(model))?.alias ?? model
}

/** Résout le (modèle, effort) EFFECTIF d'une phase pour un binding (override phase → défaut binding). */
export function resolvePhaseBinding(
  binding: RoleBinding,
  phase: PipelinePhase
): { model?: string; reasoningEffort?: ReasoningEffort } {
  const override = binding.phaseModel?.[phase]
  return {
    model: resolveBindingModel(override?.model ?? binding.model),
    reasoningEffort: override?.reasoningEffort ?? binding.reasoningEffort
  }
}

const PROVIDER_DEFAULT_SELECTIONS: Record<
  string,
  { model: string; reasoningEffort: ReasoningEffort }
> = {
  // Alias de famille (pas d'id figé) : le défaut suit le catalogue dynamique.
  claude: { model: 'claude/fable-latest', reasoningEffort: 'high' },
  codex: { model: 'codex/gpt-latest', reasoningEffort: 'medium' },
  kimi: { model: 'kimi/kimi-latest', reasoningEffort: 'none' }
}

/** Rend explicite ce que l'adaptateur utiliserait sinon implicitement. */
export function normalizeRoleBinding(binding: RoleBinding): RoleBinding {
  const defaults = PROVIDER_DEFAULT_SELECTIONS[binding.provider]
  const migrated = migrateLegacyModel(binding.model)
  if (!defaults) return { ...binding, model: migrated }
  return {
    ...binding,
    model: migrated ?? defaults.model,
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
    // Résolution alias → id de transport au point de CONSOMMATION : le binding
    // stocké garde l'alias (il suit le catalogue), le consommateur reçoit
    // toujours un id envoyable à l'adaptateur.
    const binding = this.bindings[role]
    return { ...binding, model: resolveBindingModel(binding.model) }
  }

  setBinding(role: Role, b: RoleBinding): this {
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    this.bindings[role] = normalizeRoleBinding(b)
    return this
  }

  all(): Record<Role, RoleBinding> {
    const out = {} as Record<Role, RoleBinding>
    for (const role of ALL_ROLES) out[role] = this.getBinding(role)
    return out
  }

  /** Snapshot BRUT (alias préservés) — pour la persistance : un binding sur
   *  alias reste sur alias dans roles.json et continue de suivre sa famille. */
  raw(): Record<Role, RoleBinding> {
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
