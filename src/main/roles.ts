// Configuration du modele par role du pipeline autowin.
// Chaque role (orchestrator, subagent, judge, scout) est lie a un provider
// (claude, codex, ...) et optionnellement a un modele precis ; si le modele
// est absent, le provider utilise son modele par defaut.

import type { PipelinePhase } from './skill-pipeline'
import type { ImportedModel } from './models'
import { resolveAlias } from './model-aliases'

export type Role = 'orchestrator' | 'subagent' | 'judge' | 'scout'

export const ALL_ROLES: Role[] = ['orchestrator', 'subagent', 'judge', 'scout']

export interface RoleBinding {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
  /**
   * L'ANGLE sous lequel ce membre regarde — ce qui rend un fan-out utile.
   *
   * Trois agents sur un même nœud avec le même prompt sont trois fois le même avis : le panel coûte
   * trois fois plus cher et n'apporte rien, parce que sa valeur vient de la DÉCORRÉLATION, pas du
   * nombre. La persona est donc injectée dans le prompt système du membre, jamais seulement affichée.
   */
  persona?: string
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

/**
 * Sélections par défaut par provider. `alias` = alias de FAMILLE (model-aliases.ts)
 * résolu au runtime contre le catalogue découvert → le défaut suit le modèle le plus
 * frais de la famille. `model` = fallback figé (comportement historique), utilisé
 * quand aucun catalogue n'est fourni ou que l'alias est insoluble. Kimi n'a pas de
 * listing → pas d'alias, fallback direct.
 */
const PROVIDER_DEFAULT_SELECTIONS: Record<
  string,
  { alias?: string; model: string; reasoningEffort: ReasoningEffort }
> = {
  claude: { alias: 'claude/fable-latest', model: 'claude-fable-5', reasoningEffort: 'high' },
  codex: { alias: 'codex/flagship', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  kimi: { model: 'kimi-code/kimi-for-coding', reasoningEffort: 'none' },
  gemini: { model: 'Gemini 3.5 Flash (Low)', reasoningEffort: 'none' }
}

/**
 * Rend explicite ce que l'adaptateur utiliserait sinon implicitement.
 * Avec `catalog`, un binding provider-only reçoit le modèle résolu par l'alias de
 * famille du provider ; sans catalogue (ou alias insoluble), fallback figé = 0 régression.
 * Un `binding.model` explicite reste TOUJOURS prioritaire (jamais réécrit).
 */
export function normalizeRoleBinding(
  binding: RoleBinding,
  catalog?: ImportedModel[]
): RoleBinding {
  const defaults = PROVIDER_DEFAULT_SELECTIONS[binding.provider]
  if (!defaults) return { ...binding }
  const aliasModel =
    defaults.alias && catalog ? resolveAlias(defaults.alias, catalog)?.model : undefined
  return {
    ...binding,
    model: binding.model ?? aliasModel ?? defaults.model,
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
  /** Catalogue découvert (models.ts) — alimente la résolution d'alias des normalisations FUTURES. */
  private catalog?: ImportedModel[]

  constructor(defaults?: Partial<Record<Role, RoleBinding>>, catalog?: ImportedModel[]) {
    this.catalog = catalog
    // Fusion superficielle : chaque role explicitement fourni remplace entierement
    // le binding par defaut correspondant (pas de merge partiel provider/model).
    this.bindings = { ...DEFAULT_BINDINGS }
    if (defaults) {
      for (const role of ALL_ROLES) {
        const override = defaults[role]
        if (override) {
          this.bindings[role] = normalizeRoleBinding(override, catalog)
        }
      }
    }
  }

  /**
   * Injecte le catalogue découvert (appelé post-discovery). N'altère AUCUN binding
   * existant (déjà normalisés → modèle explicite) ; seules les normalisations
   * ultérieures (setBinding provider-only) résolvent via les alias de famille.
   */
  setCatalog(catalog: ImportedModel[]): this {
    this.catalog = catalog
    return this
  }

  getCatalog(): ImportedModel[] | undefined {
    return this.catalog
  }

  getBinding(role: Role): RoleBinding {
    // Garde runtime defensive : le type Role empeche deja les valeurs invalides
    // a la compilation, mais on se protege d'un appel JS non type ou d'une
    // valeur corrompue a l'execution.
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    return this.bindings[role]
  }

  setBinding(role: Role, b: RoleBinding): this {
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    this.bindings[role] = normalizeRoleBinding(b, this.catalog)
    return this
  }

  all(): Record<Role, RoleBinding> {
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
