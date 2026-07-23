/**
 * COMPOSITION DU COMPORTEMENT (config statique) — la source de vérité de la vue « Behaviour ».
 *
 * Assemble, depuis les modules SOURCES réels, TOUT ce qui VA influer sur le comportement du chat
 * Autowin — et RIEN d'autre. Deux chemins DISTINCTS :
 *  - `orchestrated` : le pipeline (os:orchestrate → Orchestrator.run) — phases, Brain, modèle/rôle,
 *    régime, garde-fous.
 *  - `direct` : os.chat — beaucoup plus simple (kit SOUL + binding de rôle, aucun garde-fou/phase).
 *
 * INVARIANT (testé, pas jugé) :
 *  - COMPLÉTUDE : chaque catégorie A-E de l'orchestré est peuplée et tracée à sa source.
 *  - EXCLUSIVITÉ : l'objet ne décrit QUE des influenceurs réels — jamais un non-influenceur
 *    (capabilities activables, hooks natifs Claude, rôle `scout` scalaire, graphify repo-map),
 *    qui sont découplés de l'orchestrateur et ne changent RIEN au prompt/comportement d'un tour.
 *
 * Ce module ne DÉCIDE rien du comportement : il le DÉCRIT fidèlement. Les valeurs volatiles
 * (modèles découverts, caps env non définis) sont exposées comme RÈGLE, pas comme valeur figée.
 */
import { PHASE_BRIEFS } from './phase-briefs'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { PROJECT_CONTEXT_CHAIN, PROJECT_CONTEXT_MAX_BYTES } from './context-files'
import { phasesForRegime, type TaskRegime } from './task-regime'
import { resolvePhaseBinding, ALL_ROLES, type Role, type RoleBinding, type RoleModelConfig } from './roles'
import type { PipelinePhase } from './skill-pipeline'

/** Un influenceur réel : ce qu'il fait, sa valeur/règle actuelle, et sa source dans le code. */
export interface InfluencerField {
  /** Nom lisible de l'influenceur. */
  label: string
  /** Valeur ACTUELLE ou RÈGLE (si volatile), en clair. */
  value: string
  /** Citation `file:line` prouvant l'effet réel sur un tour. */
  source: string
  /** Extrait du texte réellement injecté, quand l'influenceur EST un bloc de prompt. */
  excerpt?: string
}

/** Les blocs du system prompt d'une phase orchestrée (catégorie A). */
export interface PhaseSystemPrompt {
  phase: PipelinePhase
  blocks: InfluencerField[]
}

export interface OrchestratedBehaviour {
  /** A — composition du system prompt, VARIE par phase. */
  systemPrompt: PhaseSystemPrompt[]
  /** B — contexte injecté dans le message user (hors system). */
  injectedContext: InfluencerField[]
  /** C — sélection modèle / rôle / effort (qui répond, avec quoi). */
  modelSelection: InfluencerField[]
  /** D — régime → sous-ensemble de phases joué. */
  regime: InfluencerField[]
  /** E — garde-fous déterministes. */
  guardrails: InfluencerField[]
}

export interface DirectBehaviour {
  /** Chat direct : system = kit SOUL seul (shadowé par un system explicite en orchestration). */
  systemPrompt: InfluencerField[]
  modelSelection: InfluencerField[]
}

export interface BehaviourComposition {
  orchestrated: OrchestratedBehaviour
  direct: DirectBehaviour
}

/** Coupe un long texte injecté pour l'aperçu (le texte complet reste dans la source). */
function excerpt(text: string, max = 240): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Phases orchestrées dont on décrit la composition (le juge/synthèse/réparation dérivent de celles-ci). */
const ORCHESTRATED_PHASES: PipelinePhase[] = ['scout', 'frame', 'terrain', 'build', 'clean', 'judge']

function phaseSystemPrompt(phase: PipelinePhase): PhaseSystemPrompt {
  const brief = PHASE_BRIEFS[phase] ?? ''
  const blocks: InfluencerField[] = [
    {
      label: `consigne:${phase}`,
      value: brief ? 'Brief de phase purpose-built injecté en tête du system.' : 'Aucun brief (retombe sur la discipline générique).',
      source: 'src/main/phase-briefs.ts:39',
      excerpt: brief ? excerpt(brief) : undefined
    }
  ]
  // La synthèse fan-out et le juge n'injectent PAS la discipline de pipeline (orchestrator.ts:306,527).
  if (phase !== 'judge') {
    blocks.push({
      label: 'discipline',
      value: 'Discipline de pipeline (frame→terrain→build→judge) ajoutée au system.',
      source: 'src/main/pipeline-discipline.ts:6',
      excerpt: excerpt(PIPELINE_DISCIPLINE_INSTRUCTION)
    })
  }
  blocks.push(
    {
      label: 'style',
      value: 'Profil de réponse concis-structuré.',
      source: 'src/main/response-style.ts:2',
      excerpt: excerpt(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
    },
    {
      label: 'projectContext',
      value: `Chaîne premier-trouvé-gagne : ${PROJECT_CONTEXT_CHAIN.join(' → ')} (cap ${PROJECT_CONTEXT_MAX_BYTES.toLocaleString('fr-FR')} octets), lue par Autowin depuis le workspace d'exécution.`,
      source: 'src/main/context-files.ts:76'
    }
  )
  return { phase, blocks }
}

/** Décrit le binding effectif d'un rôle (modèle/effort par défaut + overrides de phase). */
function roleField(role: Role, binding: RoleBinding): InfluencerField {
  const phaseOverrides = binding.phaseModel
    ? Object.entries(binding.phaseModel)
        .map(([ph, o]) => `${ph}:${o?.model ?? '—'}/${o?.reasoningEffort ?? '—'}`)
        .join(', ')
    : ''
  const perPhase = ALL_ROLES.includes(role)
    ? ORCHESTRATED_PHASES.map((ph) => {
        const r = resolvePhaseBinding(binding, ph)
        return `${ph}:${r.model ?? binding.model ?? 'défaut'}/${r.reasoningEffort ?? binding.reasoningEffort ?? 'défaut'}`
      }).join(', ')
    : ''
  return {
    label: `rôle ${role}`,
    value: `${binding.provider} · ${binding.model ?? 'défaut provider'} · ${binding.reasoningEffort ?? 'défaut'}${phaseOverrides ? ` — overrides phase: ${phaseOverrides}` : ''}${perPhase ? ` — effectif/phase: ${perPhase}` : ''}`,
    source: 'src/main/roles.ts:65'
  }
}

/**
 * Construit la composition statique. `roles` = la config de rôles VIVANTE (reflète les bindings
 * réellement actifs) ; `env` = pour les caps du circuit-breaker (règle si non défini).
 */
export function buildBehaviourComposition(
  roles: Pick<RoleModelConfig, 'all'>,
  env: NodeJS.ProcessEnv = process.env
): BehaviourComposition {
  const bindings = roles.all()

  const modelSelection: InfluencerField[] = [
    ...ALL_ROLES.filter((r) => r !== 'scout').map((r) => roleField(r, bindings[r])),
    {
      label: 'redirection exécution',
      value: "En exécution, si le provider ciblé ne supporte pas l'exécution, le registre REDIRIGE vers un exécuteur local outillé (codex prioritaire) en écrasant le modèle demandé — le rôle configuré n'est alors PAS celui qui exécute.",
      source: 'src/main/providers/registry.ts:69'
    },
    {
      label: 'défauts provider',
      value: 'claude→claude-fable-5/high · codex→gpt-5.6-terra/medium · kimi→…/none (appliqués si modèle/effort absents).',
      source: 'src/main/roles.ts:37'
    }
  ]

  const regime: InfluencerField[] = [
    {
      label: 'régime → phases',
      value: (['trivial', 'standard', 'critical'] as TaskRegime[])
        .map((rg) => `${rg}: [${phasesForRegime(rg).join(', ')}]`)
        .join(' · '),
      source: 'src/main/task-regime.ts:18'
    },
    {
      label: 'signaux déclencheurs',
      value: 'RegEx déterministe (aucun appel modèle) : signaux CRITICAL (architect/refactor/migrat/sécurité/pipeline/prod…) → critical ; signaux TRIVIAL (typo/rename/lint/format…) + tâche courte → trivial ; sinon standard.',
      source: 'src/main/task-regime.ts:25'
    }
  ]

  const usdCap = env.AUTOWIN_RUN_USD_CAP
  const tokenCap = env.AUTOWIN_RUN_TOKEN_CAP
  const guardrails: InfluencerField[] = [
    {
      label: 'circuit-breaker coût',
      value: `Coupe le run (abort réel) au dépassement des caps. USD cap: ${usdCap ?? 'non défini (désactivé)'} · Token cap: ${tokenCap ?? 'non défini (désactivé)'} — lus par tour.`,
      source: 'src/main/cost-circuit-breaker.ts:28'
    },
    {
      label: 'exigence de preuve (mutation)',
      value: "Une tâche de MUTATION exige une preuve (evidence mutation+verification) avant le vert, et tourne en sandbox danger-full-access ; sinon read-only. isMutationTask (regex) pilote les deux.",
      source: 'src/main/orchestrator.ts:132'
    },
    {
      label: 'gate de clôture',
      value: 'evaluateClosure (pur, model-agnostic) bloque sur statut open/red, DoD non cochée, ou signal exit≠0 ; degraded-closed ne bloque jamais.',
      source: 'src/main/gates/stopgate.ts:31'
    },
    {
      label: 'réparation bornée',
      value: '2 tentatives pour une mutation (la 2e réinjecte les raisons du gate), 1 sinon.',
      source: 'src/main/orchestrator.ts:709'
    }
  ]

  const injectedContext: InfluencerField[] = [
    {
      label: 'RAG Brain',
      value: 'Récupéré 1×/run (POST 127.0.0.1:8765/query, Bearer token), préfixé en tête du contexte + consigne « priorise le Brain ». Dégrade silencieusement à vide (timeout 5 s / pas de token / serveur absent).',
      source: 'src/main/brain-retrieval.ts:92'
    },
    { label: 'TÂCHE', value: 'La demande brute, toujours présente en 1ʳᵉ phase.', source: 'src/main/orchestrator.ts:205' },
    {
      label: 'portage phase→phase',
      value: 'La sortie de chaque phase est portée à la suivante, tronquée à 2000 caractères.',
      source: 'src/main/orchestrator.ts:116'
    },
    {
      label: 'session-resume chaîné',
      value: "Si le provider rend un sessionId, les phases suivantes n'envoient QUE leur consigne (le reste est déjà dans l'historique de session) — contenu réellement envoyé variable/opaque ; cassé dès un fan-out.",
      source: 'src/main/orchestrator.ts:398'
    },
    {
      label: 'agrégat juge',
      value: 'Le juge reçoit la concaténation des sorties de phases, chaque bloc plafonné à 6000 caractères.',
      source: 'src/main/orchestrator.ts:482'
    }
  ]

  const direct: DirectBehaviour = {
    systemPrompt: [
      {
        label: 'kit SOUL',
        value: 'CHAT DIRECT SEULEMENT : le kit condensé (resources/kit-soul.md) est le system du chat direct. En orchestration il est TOUJOURS shadowé par le system explicite des phases → sans effet là-bas.',
        source: 'src/main/kit.ts:12'
      }
    ],
    modelSelection: [
      {
        label: 'binding de rôle',
        value: `Le chat direct utilise le binding du rôle demandé (défaut orchestrator: ${bindings.orchestrator.provider}/${bindings.orchestrator.model ?? 'défaut'}). Aucune phase, aucun Brain, aucun garde-fou.`,
        source: 'src/main/os.ts:166'
      }
    ]
  }

  return {
    orchestrated: {
      systemPrompt: ORCHESTRATED_PHASES.map(phaseSystemPrompt),
      injectedContext,
      modelSelection,
      regime,
      guardrails
    },
    direct
  }
}
