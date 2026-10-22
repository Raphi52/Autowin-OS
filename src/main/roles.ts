// Configuration du modele par role du pipeline autowin.
// Chaque role (orchestrator, subagent, judge, scout) est lie a un provider
// (claude, codex, ...) et optionnellement a un modele precis ; si le modele
// est absent, le provider utilise son modele par defaut.

import type { PipelinePhase, NodePhase } from './skill-pipeline'
import type { ImportedModel } from './models'
import type { TaskRegime } from './task-regime'
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
  phaseModel?: Partial<
    Record<
      PipelinePhase,
      {
        model?: string
        reasoningEffort?: ReasoningEffort
        /**
         * Modèle ADVISOR de l'étape (Claude Code `--advisor`, conv-1083) : par exemple build sur
         * Sonnet avec Opus en renfort aux moments qui décident. Absent = pas d'advisor (défaut).
         * Ne part que sur un accord accepté par le CLI (`providers/claude-advisor.ts`).
         */
        advisorModel?: string
      }
    >
  >
}

/** Résout le (modèle, effort) EFFECTIF d'une phase pour un binding (override phase → défaut binding). */
export function resolvePhaseBinding(
  binding: RoleBinding,
  phase: NodePhase
): { model?: string; reasoningEffort?: ReasoningEffort; advisorModel?: string } {
  const override = binding.phaseModel?.[phase as PipelinePhase]
  return {
    model: override?.model ?? binding.model,
    reasoningEffort: override?.reasoningEffort ?? binding.reasoningEffort,
    // L'advisor est PAR ÉTAPE seulement : il n'hérite d'aucun réglage du rôle (conv-1083).
    ...(override?.advisorModel ? { advisorModel: override.advisorModel } : {})
  }
}

/**
 * L'EFFORT PAR DÉFAUT D'UNE ÉTAPE (conv-955, 2026-10-15).
 *
 * Mesuré dans `prompt-observability` : les 100 appels d'étapes et les 63 juges partaient TOUS à
 * l'effort du rôle (`xhigh`), qu'il s'agisse d'écrire le code (build) ou de noter une leçon (learn).
 * Rien ne faisait ce choix : `phaseModel` le permet, mais seulement à la main, sans écran, et pas pour
 * think/learn/salvage (hors `PipelinePhase`).
 *
 * La règle ne s'applique QUE quand l'effort de l'étape HÉRITE du réglage du rôle : un `phaseModel`,
 * l'effort propre d'un agent du canevas ou un binding figé passent devant (décidé à l'appelant).
 * - Crans retirés selon l'étape : build et salvage jamais ; scout/frame/terrain un ; clean/think/learn deux.
 * - La difficulté de la demande (`classifyRegime`) n'agit que sur les étapes baissées : difficile en
 *   rend un, triviale en retire un de plus. Une erreur de classement coûte du temps, jamais build.
 * - PLAFOND = le réglage (jamais au-dessus, ni `max` ni `ultra`). PLANCHER = le plus bas effort de la
 *   liste DU MODÈLE : `minimal` ou `none` hors liste seraient retirés sans bruit par l'adaptateur
 *   (`claude.ts`, EFFORTS_CLI_CLAUDE) et le CLI retomberait sur son propre défaut.
 * - Liste du modèle inconnue, ou réglage absent de cette liste : le réglage repart tel quel.
 * Fonction pure : mêmes entrées → même effort, donc une reprise de run retombe sur la même valeur.
 */
const CRANS_RETIRES_PAR_ETAPE: Readonly<Record<string, number>> = {
  build: 0,
  salvage: 0,
  scout: 1,
  frame: 1,
  terrain: 1,
  clean: 2,
  think: 2,
  learn: 2
}

const CRANS_RENDUS_PAR_DIFFICULTE: Readonly<Record<TaskRegime, number>> = {
  critical: 1,
  standard: 0,
  trivial: -1
}

// fix-ok: conv-955 — cause mesuree : aucune regle ne choisissait l'effort par etape (prompt-observability :
// 100 appels d'etapes et 63 juges, tous a l'effort du role `xhigh`) ; effort-par-etape.test.ts rouge
// (fonction absente) puis vert 10/10.
export function effortParDefautDeLEtape(
  phase: NodePhase,
  difficulte: TaskRegime,
  reglage: ReasoningEffort | undefined,
  effortsDuModele: readonly ReasoningEffort[] | undefined
): ReasoningEffort | undefined {
  if (!reglage) return reglage
  const retires = Object.hasOwn(CRANS_RETIRES_PAR_ETAPE, phase) ? CRANS_RETIRES_PAR_ETAPE[phase] : 0
  if (retires <= 0) return reglage
  // Rangée dans l'ordre canonique : l'ordre de la liste déclarée par le modèle ne compte pas.
  const echelle = REASONING_EFFORTS.filter((effort) => effortsDuModele?.includes(effort))
  const rang = echelle.indexOf(reglage)
  if (rang < 0) return reglage
  const rendus = Object.hasOwn(CRANS_RENDUS_PAR_DIFFICULTE, difficulte)
    ? CRANS_RENDUS_PAR_DIFFICULTE[difficulte]
    : 0
  const descente = Math.max(0, retires - rendus)
  return echelle[Math.max(0, rang - descente)]
}

/**
 * Sélections par défaut par provider. `alias` = alias de FAMILLE (model-aliases.ts)
 * résolu au runtime contre le catalogue découvert → le défaut suit le modèle le plus
 * frais de la famille. `model` = fallback figé (comportement historique), utilisé
 * quand aucun catalogue n'est fourni ou que l'alias est insoluble. Les moteurs retirés n'ont plus
 * d'entrée du tout.
 */
const PROVIDER_DEFAULT_SELECTIONS: Record<
  string,
  { alias?: string; model: string; reasoningEffort: ReasoningEffort }
> = {
  claude: { alias: 'claude/fable-latest', model: 'claude-fable-5', reasoningEffort: 'high' }
  // Moteurs retirés (codex, kimi, gemini) : plus de défaut publié. Un binding qui les nomme encore
  // ressort INCHANGÉ — il n'est pas complété en silence vers un modèle mort.
}

/**
 * Rend explicite ce que l'adaptateur utiliserait sinon implicitement.
 * Avec `catalog`, un binding provider-only reçoit le modèle résolu par l'alias de
 * famille du provider ; sans catalogue (ou alias insoluble), fallback figé = 0 régression.
 * Un `binding.model` explicite reste TOUJOURS prioritaire (jamais réécrit).
 */
export function normalizeRoleBinding(binding: RoleBinding, catalog?: ImportedModel[]): RoleBinding {
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

/** Config par defaut : Claude sur les quatre rôles — c'est le seul moteur routé. */
const DEFAULT_BINDINGS: Record<Role, RoleBinding> = {
  orchestrator: normalizeRoleBinding({ provider: 'claude' }),
  subagent: normalizeRoleBinding({ provider: 'claude' }),
  judge: normalizeRoleBinding({ provider: 'claude' }),
  scout: normalizeRoleBinding({ provider: 'claude' })
}

/**
 * LE MODÈLE DES PETITES TÂCHES (conv-264, 2026-10-11).
 *
 * Deux appels courts tournaient en fond, hors pipeline : le TRI des conversations (même sujet ou
 * nouveau fil ? — retiré le 2026-10-17, conv-305) et le CHOIX AUTOMATIQUE du workflow, qui reste. Aucun n'avait de réglage : le tri forçait le
 * défaut du code (`claude-fable-5`, 2× le prix d'Opus — 449 appels pour 28,68 $ relevés dans
 * `activity/*.jsonl`), le choix du workflow forçait l'effort `low` sur le modèle du chat.
 *
 * Désormais l'utilisateur le règle lui-même (écran Routeur, clé `petitesTaches` de `roles.json`).
 * Non réglé, il suit le modèle du CHAT — un choix qu'il a fait — en effort `low` : l'effort d'avant
 * pour ces deux appels, affiché tel quel à l'écran. Aucun modèle n'est inventé par le code.
 */
export const EFFORT_PETITES_TACHES_NON_REGLE: ReasoningEffort = 'low'

export function bindingDesPetitesTaches(
  reglage: RoleBinding | undefined,
  chat: RoleBinding
): RoleBinding {
  if (reglage) return { ...reglage }
  return {
    provider: chat.provider,
    ...(chat.model ? { model: chat.model } : {}),
    reasoningEffort: EFFORT_PETITES_TACHES_NON_REGLE
  }
}

/** Ce que l'écran Routeur lit : le réglage posé (null = jamais posé) et le binding qui part. */
export interface PetitesTachesEtat {
  reglage: RoleBinding | null
  effectif: RoleBinding
}

/** Contenu de `roles.json` : les quatre rôles, plus le réglage des petites tâches s'il existe. */
export type RolesPersistes = Partial<Record<Role, RoleBinding>> & { petitesTaches?: RoleBinding }

export class RoleModelConfig {
  private bindings: Record<Role, RoleBinding>
  /** Catalogue découvert (models.ts) — alimente la résolution d'alias des normalisations FUTURES. */
  private catalog?: ImportedModel[]
  /** Réglage EXPLICITE des petites tâches ; absent = suit le modèle du chat. */
  private petitesTaches?: RoleBinding

  constructor(defaults?: RolesPersistes, catalog?: ImportedModel[]) {
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
      // Jamais normalisé : la normalisation compléterait un binding sans modèle par le défaut du
      // code, exactement le choix caché que ce réglage remplace.
      if (defaults.petitesTaches) this.petitesTaches = { ...defaults.petitesTaches }
    }
  }

  /** Le réglage tel que l'utilisateur l'a posé, ou `undefined` s'il ne l'a jamais posé. */
  getPetitesTaches(): RoleBinding | undefined {
    return this.petitesTaches ? { ...this.petitesTaches } : undefined
  }

  /** Pose (ou efface avec `undefined`) le réglage des petites tâches. */
  setPetitesTaches(binding: RoleBinding | undefined): this {
    this.petitesTaches = binding ? { ...binding } : undefined
    return this
  }

  /** Le binding qui part VRAIMENT pour le tri et le choix du workflow. */
  bindingDesPetitesTaches(): RoleBinding {
    return bindingDesPetitesTaches(this.petitesTaches, this.getBinding('orchestrator'))
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
const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort)
}
