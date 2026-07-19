/**
 * Projection « Harnais » — composée côté main, LECTURE SEULE et BORNÉE.
 *
 * `composeHarnessSnapshot` est PURE : elle reçoit des données déjà inventoriées
 * et bornées (compteurs, étiquettes, tailles — JAMAIS de contenu de fichier, de
 * commande de hook, de secret ni de prompt), et en dérive un graphe explicatif
 * du harnais autour du modèle. La récolte réelle (services/disque) vit dans
 * `os.ts` ; l'endpoint IPC n'accepte AUCUN chemin et ne mute rien.
 *
 * Les types sont un MIROIR STRUCTUREL de
 * `src/renderer/src/components/harness-model.ts` (gardés identiques — la
 * frontière IPC est structurelle). La redaction est garantie par CONSTRUCTION :
 * l'entrée ne porte que des compteurs et des libellés.
 */
import type { Role } from '../roles'

export type HarnessLayer = 'runtime' | 'configuration' | 'storage' | 'observability'
export type HarnessSource = 'ipc' | 'filesystem' | 'provider-boundary' | 'derived'
export type HarnessState = 'healthy' | 'unknown' | 'warning' | 'blocked' | 'inactive'
export type HarnessRuntime = 'autowin-local' | 'provider' | 'shared-brain' | 'none'

export type HarnessNodeKind =
  | 'you'
  | 'model'
  | 'provider'
  | 'orchestrator'
  | 'subagent'
  | 'scout'
  | 'judge'
  | 'runtime'
  | 'pilot'
  | 'command-bus'
  | 'loop'
  | 'roles'
  | 'skill'
  | 'hook'
  | 'tool'
  | 'behaviour'
  | 'authority'
  | 'gate'
  | 'kit'
  | 'brain'
  | 'conversation'
  | 'run'
  | 'cost'
  | 'trust'
  | 'activity'
  | 'trace'
  | 'question'
  | 'kaizen'

export type HarnessEdgeKind =
  'executes' | 'routes' | 'invokes' | 'injects' | 'reads' | 'persists' | 'observes' | 'gates'

export type HarnessFlow = 'chat' | 'orchestration' | 'loop' | 'pilotage' | 'brain' | 'observability'
export type HarnessLevel = 'beginner' | 'expert' | 'both'

export interface HarnessEvidence {
  source: HarnessSource
  ref: string
  detail?: string
}
export interface HarnessMetric {
  label: string
  value: string | number
}
export interface HarnessNode {
  id: string
  kind: HarnessNodeKind
  label: string
  layer: HarnessLayer
  source: HarnessSource
  state: HarnessState
  runtime: HarnessRuntime
  level: HarnessLevel
  flows: HarnessFlow[]
  role?: string
  provider?: string
  order: number
  focal?: boolean
  evidence: HarnessEvidence
  roleDesc: string
  observed: string
  notObserved: string
  references: string[]
  metrics?: HarnessMetric[]
}
export interface HarnessEdge {
  id: string
  from: string
  to: string
  kind: HarnessEdgeKind
  flows: HarnessFlow[]
  level: HarnessLevel
  label?: string
}
export interface HarnessCaps {
  maxNodes: number
  maxEdges: number
  nodeCount: number
  edgeCount: number
  truncated: boolean
}
export interface HarnessSnapshot {
  generatedAt: string
  focusModelId: string
  nodes: HarnessNode[]
  edges: HarnessEdge[]
  caps: HarnessCaps
  providers: string[]
  runtimes: HarnessRuntime[]
}

/* --- Caps & bornes de payload ------------------------------------------- */

export const MAX_HARNESS_NODES = 250
export const MAX_HARNESS_EDGES = 500
const MAX_TEXT = 240
const MAX_REFS = 6
const MAX_METRICS = 6

const ALLOWED_LAYERS = new Set<HarnessLayer>([
  'runtime',
  'configuration',
  'storage',
  'observability'
])
const ALLOWED_EDGE_KINDS = new Set<HarnessEdgeKind>([
  'executes',
  'routes',
  'invokes',
  'injects',
  'reads',
  'persists',
  'observes',
  'gates'
])
const ALLOWED_STATES = new Set<HarnessState>([
  'healthy',
  'unknown',
  'warning',
  'blocked',
  'inactive'
])

/* --- Entrée bornée (récoltée par os.ts) --------------------------------- */

export interface HarnessSnapshotInput {
  generatedAt: string
  /** Bindings rôle→provider/modèle (config lue en clair, pas un secret). */
  roleBindings: Record<Role, { provider: string; model?: string }>
  /** Providers enregistrés (identifiants seulement, ex. 'claude'|'codex'). */
  providers: string[]
  /** Modèle actif = binding de l'orchestrateur, résolu. */
  activeModel: { id: string; provider: string }
  /** Kit SOUL : présence + taille SEULEMENT (jamais le contenu injecté). */
  kit: { injected: boolean; size: number }
  /** Compteurs d'inventaire. `null` = inventaire indisponible → état `unknown`. */
  counts: {
    skills: number | null
    tools: number | null
    hooks: number | null
    behaviour: number | null
    conversations: number
    sessions: number
    trustModels: number
  }
  /** Évènements de hooks (noms redigés, JAMAIS de commande). */
  hookEvents: string[]
  /** Répartition Behaviour par moteur, ou `null` si indisponible. */
  behaviourByEngine: { codex: number; claude: number; hermes: number } | null
  /** Réfs de graphes du Brain : identité + taille, jamais le contenu des notes. */
  brains: Array<{
    id: string
    label: string
    kind: 'vault' | 'graphify'
    sizeMb: number
    themes: number
  }>
  /** Runs vivants : compteurs dérivés du stop-gate. */
  runs: { total: number; blocked: number; open: number }
  /** Budget coût réel (agrégateur en mémoire). */
  budget: { spent: number; budget: number | null; alert: boolean }
  /** Décisions AFK ouvertes (SAS d'autorité). */
  pendingAuthority: number
}

/* --- Helpers de dérivation ---------------------------------------------- */

const clamp = (text: string): string =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text

/** Compteur → état honnête : inconnu si non inventorié, inactif si vide. */
function countState(n: number | null): HarnessState {
  if (n === null) return 'unknown'
  return n > 0 ? 'healthy' : 'inactive'
}

interface NodeSpec extends Omit<HarnessNode, 'evidence' | 'references' | 'metrics'> {
  evidence: HarnessEvidence
  references?: string[]
  metrics?: HarnessMetric[]
}

function makeNode(spec: NodeSpec): HarnessNode {
  return {
    ...spec,
    label: clamp(spec.label),
    roleDesc: clamp(spec.roleDesc),
    observed: clamp(spec.observed),
    notObserved: clamp(spec.notObserved),
    evidence: { ...spec.evidence, ref: clamp(spec.evidence.ref) },
    references: (spec.references ?? []).slice(0, MAX_REFS).map(clamp),
    metrics: (spec.metrics ?? []).slice(0, MAX_METRICS).map((m) => ({
      label: clamp(m.label),
      value: typeof m.value === 'string' ? clamp(m.value) : m.value
    }))
  }
}

/**
 * Compose le graphe du harnais. Pure, déterministe, bornée. Lève si un
 * invariant est violé (arête orpheline, Brain exécuteur, etc.).
 */
export function composeHarnessSnapshot(input: HarnessSnapshotInput): HarnessSnapshot {
  const orchestratorProvider = input.roleBindings.orchestrator.provider
  const subagentProvider = input.roleBindings.subagent.provider
  const judgeProvider = input.roleBindings.judge.provider
  const scoutProvider = input.roleBindings.scout.provider
  const modelLabel = input.activeModel.id

  const nodes: HarnessNode[] = [
    /* ---------- Runtime local (cyan) ---------- */
    makeNode({
      id: 'you',
      kind: 'you',
      label: 'Vous',
      layer: 'runtime',
      source: 'derived',
      state: 'healthy',
      runtime: 'none',
      level: 'both',
      flows: ['chat', 'pilotage'],
      order: 0,
      evidence: { source: 'derived', ref: 'Point d’entrée humain' },
      roleDesc: 'L’humain qui pose une demande et tranche les décisions réservées.',
      observed: 'Vos messages et vos réponses aux questions du modèle.',
      notObserved: 'Votre intention hors de ce qui est écrit.',
      references: ['renderer/App.tsx']
    }),
    makeNode({
      id: 'autowin',
      kind: 'runtime',
      label: 'Autowin OS (local)',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['chat', 'orchestration', 'loop', 'pilotage', 'observability'],
      order: 1,
      evidence: { source: 'ipc', ref: 'main/os.ts · AutowinOS' },
      roleDesc:
        'Le cockpit local : reçoit vos demandes, route vers les rôles, agrège coût et traces.',
      observed: 'Les tours de chat, les orchestrations et les commandes du plan de contrôle.',
      notObserved: 'Ce qui se passe à l’intérieur du provider distant.',
      references: ['main/os.ts', 'main/index.ts']
    }),
    makeNode({
      id: 'orchestrator',
      kind: 'orchestrator',
      label: 'Orchestrateur',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      role: 'orchestrator',
      provider: orchestratorProvider,
      flows: ['chat', 'orchestration', 'loop', 'pilotage'],
      order: 2,
      evidence: { source: 'ipc', ref: 'main/orchestrator.ts' },
      roleDesc: 'Pilote le pipeline (exécute → juge → gate) sans faire le travail des sous-agents.',
      observed: 'Chaque étape exec/judge/gate, son provider, son coût en tokens.',
      notObserved: 'Le raisonnement interne du modèle qu’il appelle.',
      references: ['main/orchestrator.ts'],
      metrics: [{ label: 'Provider', value: orchestratorProvider }]
    }),
    makeNode({
      id: 'subagent',
      kind: 'subagent',
      label: 'Sous-agent',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      role: 'subagent',
      provider: subagentProvider,
      flows: ['orchestration'],
      order: 3,
      evidence: { source: 'ipc', ref: 'main/roles.ts · binding subagent' },
      roleDesc: 'Exécute un sous-objectif borné et rend un artefact vérifiable.',
      observed: 'L’étape exec produite et son coût.',
      notObserved: 'Les tours internes non remontés par le provider.',
      references: ['main/orchestrator.ts', 'main/roles.ts'],
      metrics: [{ label: 'Provider', value: subagentProvider }]
    }),
    makeNode({
      id: 'scout',
      kind: 'scout',
      label: 'Scout',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      role: 'scout',
      provider: scoutProvider,
      flows: ['orchestration'],
      order: 4,
      evidence: { source: 'ipc', ref: 'main/roles.ts · binding scout' },
      roleDesc: 'Éclaire une cible en lecture seule et propose une shortlist de pistes.',
      observed: 'Le binding provider du rôle scout.',
      notObserved: 'Le détail d’une exploration (le scout tourne côté provider).',
      references: ['main/roles.ts'],
      metrics: [{ label: 'Provider', value: scoutProvider }]
    }),
    makeNode({
      id: 'judge',
      kind: 'judge',
      label: 'Juge',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      role: 'judge',
      provider: judgeProvider,
      flows: ['orchestration', 'observability'],
      order: 5,
      evidence: { source: 'ipc', ref: 'main/orchestrator.ts · étape judge' },
      roleDesc:
        'Challenge le résultat avant sortie ; son verdict alimente la calibration de confiance.',
      observed: 'Le verdict (green/red) et sa trace.',
      notObserved: 'La vérité terrain tant qu’un humain ne l’a pas confirmée.',
      references: ['main/orchestrator.ts', 'main/trust/ledger.ts'],
      metrics: [{ label: 'Provider', value: judgeProvider }]
    }),
    makeNode({
      id: 'provider-claude',
      kind: 'provider',
      label: 'Provider · claude',
      layer: 'runtime',
      source: 'provider-boundary',
      state: 'unknown',
      runtime: 'provider',
      level: 'expert',
      provider: 'claude',
      flows: ['chat', 'orchestration'],
      order: 6,
      evidence: { source: 'provider-boundary', ref: 'main/providers/claude.ts' },
      roleDesc: 'Adaptateur claude-code (abonnement, pas de clé API). Sert les tours du modèle.',
      observed: 'Que le bloc système a été injecté ; les tokens remontés.',
      notObserved: 'La liveness : aucune sonde auth() n’est lancée depuis cette vue.',
      references: ['main/providers/claude.ts']
    }),
    makeNode({
      id: 'provider-codex',
      kind: 'provider',
      label: 'Provider · codex',
      layer: 'runtime',
      source: 'provider-boundary',
      state: 'unknown',
      runtime: 'provider',
      level: 'expert',
      provider: 'codex',
      flows: ['orchestration'],
      order: 7,
      evidence: { source: 'provider-boundary', ref: 'main/providers/codex.ts' },
      roleDesc: 'Adaptateur Codex via OAuth ChatGPT (device-code). Sert le rôle scout par défaut.',
      observed: 'Le modèle configuré et le bloc système injecté.',
      notObserved: 'La liveness distante : aucune sonde réseau lancée ici.',
      references: ['main/providers/codex.ts']
    }),
    makeNode({
      id: 'model',
      kind: 'model',
      label: modelLabel,
      layer: 'runtime',
      source: 'provider-boundary',
      state: 'unknown',
      runtime: 'provider',
      level: 'both',
      focal: true,
      provider: input.activeModel.provider,
      flows: ['chat', 'orchestration'],
      order: 9,
      evidence: { source: 'provider-boundary', ref: 'binding orchestrateur' },
      roleDesc:
        'Le modèle actif au cœur du harnais : tout le reste l’entoure, le nourrit et le vérifie.',
      observed: 'Le provider qui le sert et le coût de ses tours.',
      notObserved: 'Son état de disponibilité (aucune sonde) et son raisonnement interne.',
      references: ['main/providers/registry.ts'],
      metrics: [
        { label: 'Provider actif', value: input.activeModel.provider },
        { label: 'Providers câblés', value: input.providers.join(', ') || '—' }
      ]
    }),
    makeNode({
      id: 'pilot',
      kind: 'pilot',
      label: 'Agent pilote',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['pilotage'],
      order: 10,
      evidence: { source: 'ipc', ref: 'main/agent-pilot.ts' },
      roleDesc: 'Boucle outil : un agent converse ET pilote l’app dans le même tour.',
      observed: 'Chaque commande émise sur le plan de contrôle.',
      notObserved: 'Les décisions internes du modèle entre deux commandes.',
      references: ['main/agent-pilot.ts']
    }),
    makeNode({
      id: 'command-bus',
      kind: 'command-bus',
      label: 'Plan de contrôle',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['pilotage'],
      order: 11,
      evidence: { source: 'ipc', ref: 'main/commands.ts · AppCommandBus' },
      roleDesc: 'Catalogue borné de commandes par lesquelles un agent conduit l’UI (navigate…).',
      observed: 'Chaque commande exécutée est tracée.',
      notObserved: 'Rien au-delà des commandes déclarées au catalogue.',
      references: ['main/commands.ts']
    }),
    makeNode({
      id: 'loop',
      kind: 'loop',
      label: 'Boucle de skills',
      layer: 'runtime',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['loop'],
      order: 12,
      evidence: { source: 'ipc', ref: 'main/loop-runner.ts' },
      roleDesc: 'Enchaîne des skills en passes multiples (scout→frame→…→judge).',
      observed: 'Les évènements de début/fin de chaque étape.',
      notObserved: 'Le contenu produit à l’intérieur d’une skill.',
      references: ['main/loop-runner.ts', 'main/loop-skills.ts']
    }),

    /* ---------- Configuration (or) ---------- */
    makeNode({
      id: 'roles',
      kind: 'roles',
      label: 'Rôles & bindings',
      layer: 'configuration',
      source: 'filesystem',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['orchestration'],
      order: 0,
      evidence: { source: 'filesystem', ref: 'roles.json (%APPDATA%\\autowin-os)' },
      roleDesc:
        'Quel provider/modèle sert chaque rôle. Persisté sur disque, restauré au démarrage.',
      observed: 'Le binding effectif de chaque rôle.',
      notObserved: 'Rien : la config est lue en clair.',
      references: ['main/roles.ts', 'main/role-store.ts'],
      metrics: [
        { label: 'orchestrator', value: orchestratorProvider },
        { label: 'subagent', value: subagentProvider },
        { label: 'judge', value: judgeProvider },
        { label: 'scout', value: scoutProvider }
      ]
    }),
    makeNode({
      id: 'kit',
      kind: 'kit',
      label: 'Kit SOUL (bloc système)',
      layer: 'configuration',
      source: 'filesystem',
      state: input.kit.injected ? 'healthy' : 'inactive',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['chat', 'orchestration'],
      order: 1,
      evidence: { source: 'filesystem', ref: 'resources/kit-soul.md' },
      roleDesc: 'Kit condensé injecté comme bloc système sur CHAQUE tour, uniformément.',
      observed: 'Sa présence et sa taille ; l’injection est prouvée par tour.',
      notObserved: 'Son contenu n’est jamais affiché ici (redaction).',
      references: ['main/kit.ts', 'main/providers/registry.ts'],
      metrics: [
        { label: 'Injecté', value: input.kit.injected ? 'oui' : 'non' },
        { label: 'Taille', value: `${input.kit.size} c.` }
      ]
    }),
    makeNode({
      id: 'skills',
      kind: 'skill',
      label: 'Skills',
      layer: 'configuration',
      source: 'ipc',
      state: countState(input.counts.skills),
      runtime: 'autowin-local',
      level: 'both',
      flows: ['orchestration', 'loop'],
      order: 2,
      evidence: { source: 'ipc', ref: 'hermes-controls · listHermesControls(skills)' },
      roleDesc: 'Les procédures nommées que le modèle peut charger (scout, frame, build, judge…).',
      observed: 'Le nombre de skills disponibles (inventaire borné Hermes).',
      notObserved: 'Le contenu des SKILL.md n’est pas exposé ici.',
      references: ['main/hermes-controls.ts', 'main/loop-skills.ts'],
      metrics: [{ label: 'Disponibles', value: input.counts.skills ?? 'inconnu' }]
    }),
    makeNode({
      id: 'hooks',
      kind: 'hook',
      label: 'Hooks',
      layer: 'configuration',
      source: 'filesystem',
      state: countState(input.counts.hooks),
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['orchestration', 'observability'],
      order: 3,
      evidence: { source: 'filesystem', ref: 'settings.json (~/.claude) · commandes redigées' },
      roleDesc:
        'Autorité de clôture déterministe : ils lisent un artefact et bloquent ou laissent passer.',
      observed: 'Le nombre de hooks et leurs évènements.',
      notObserved: 'Les commandes des hooks sont redigées — jamais affichées.',
      references: ['main/claude-hooks.ts'],
      metrics: [
        { label: 'Déclarés', value: input.counts.hooks ?? 'inconnu' },
        { label: 'Évènements', value: [...new Set(input.hookEvents)].join(', ') || '—' }
      ]
    }),
    makeNode({
      id: 'tools',
      kind: 'tool',
      label: 'Tools Hermes',
      layer: 'configuration',
      source: 'ipc',
      state: countState(input.counts.tools),
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['pilotage', 'orchestration'],
      order: 4,
      evidence: { source: 'ipc', ref: 'hermes-controls · listHermesControls(tools)' },
      roleDesc: 'Les outils activables côté Hermes que les agents peuvent invoquer.',
      observed: 'Le nombre d’outils exposés.',
      notObserved: 'Le détail d’implémentation de chaque outil.',
      references: ['main/hermes-controls.ts'],
      metrics: [{ label: 'Exposés', value: input.counts.tools ?? 'inconnu' }]
    }),
    makeNode({
      id: 'behaviour',
      kind: 'behaviour',
      label: 'Instructions effectives',
      layer: 'configuration',
      source: 'filesystem',
      state: countState(input.counts.behaviour),
      runtime: 'autowin-local',
      level: 'both',
      flows: ['orchestration'],
      order: 5,
      evidence: { source: 'filesystem', ref: 'behaviour-files · racines revalidées' },
      roleDesc:
        'La chaîne d’instructions qui gouverne chaque moteur (Codex/Claude/Hermes), du global au projet.',
      observed: 'Le nombre de fichiers effectifs et leur moteur.',
      notObserved: 'Leur contenu n’est pas affiché dans cette vue.',
      references: ['main/behaviour-files.ts'],
      metrics: input.behaviourByEngine
        ? [
            { label: 'Codex', value: input.behaviourByEngine.codex },
            { label: 'Claude', value: input.behaviourByEngine.claude },
            { label: 'Hermes', value: input.behaviourByEngine.hermes }
          ]
        : [{ label: 'Fichiers', value: 'inconnu' }]
    }),
    makeNode({
      id: 'authority',
      kind: 'authority',
      label: 'SAS d’autorité',
      layer: 'configuration',
      source: 'ipc',
      state: input.pendingAuthority > 0 ? 'warning' : 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['orchestration'],
      order: 6,
      evidence: { source: 'ipc', ref: 'main/authority/sas.ts' },
      roleDesc: 'Ouvre une décision humaine (AFK) quand le gate bloque, avec défaut sûr et TTL.',
      observed: 'Les décisions ouvertes en attente.',
      notObserved: 'Rien au-delà des décisions déclarées.',
      references: ['main/authority/sas.ts'],
      metrics: [{ label: 'En attente', value: input.pendingAuthority }]
    }),
    makeNode({
      id: 'gate',
      kind: 'gate',
      label: 'Stop-gate',
      layer: 'configuration',
      source: 'ipc',
      state: input.runs.open > 0 ? 'blocked' : 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['orchestration', 'observability'],
      order: 7,
      evidence: { source: 'ipc', ref: 'main/gates/stopgate.ts' },
      roleDesc: 'Clôture déterministe : lit les RUN.md et bloque tant qu’un run est ouvert/rouge.',
      observed: 'Le statut des runs vivants (open/red/green/degraded-closed).',
      notObserved: 'La qualité réelle au-delà des artefacts vérifiés.',
      references: ['main/gates/stopgate.ts', 'main/dashboards/runs.ts'],
      metrics: [
        { label: 'Runs ouverts', value: input.runs.open },
        { label: 'Bloqués', value: input.runs.blocked }
      ]
    }),

    /* ---------- Stockage & connaissance (violet) ---------- */
    makeNode({
      id: 'brain',
      kind: 'brain',
      label: 'Brain partagé (lecture seule)',
      layer: 'storage',
      source: 'filesystem',
      state: input.brains.length > 0 ? 'healthy' : 'unknown',
      runtime: 'shared-brain',
      level: 'both',
      flows: ['brain'],
      order: 0,
      evidence: {
        source: 'filesystem',
        ref: '\\\\ged2\\rig\\Projets IA\\Amitel Brain (+ ~/.graphify)'
      },
      roleDesc:
        'Connaissance durable partagée (vault Obsidian + graphes de code). Consultée, JAMAIS exécuteur.',
      observed: 'Les graphes disponibles, leur type et leur taille.',
      notObserved:
        'Le contenu des notes n’est pas chargé ici ; la disponibilité SMB si le partage est hors ligne.',
      references: ['main/viz/fs-brains.ts'],
      metrics: [
        { label: 'Graphes', value: input.brains.length },
        { label: 'Vaults', value: input.brains.filter((b) => b.kind === 'vault').length }
      ]
    }),
    makeNode({
      id: 'conversations',
      kind: 'conversation',
      label: 'Conversations',
      layer: 'storage',
      source: 'ipc',
      state: input.counts.conversations > 0 ? 'healthy' : 'inactive',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['chat', 'observability'],
      order: 1,
      evidence: { source: 'filesystem', ref: 'store/conversations-disk.ts' },
      roleDesc:
        'Les fils de discussion catégorisés, persistés sur disque et rechargés au démarrage.',
      observed: 'Le nombre de conversations et leur activité facturée.',
      notObserved: 'Rien : les fils sont relus tels quels.',
      references: ['main/store/conversations.ts', 'main/store/conversations-disk.ts'],
      metrics: [{ label: 'Fils', value: input.counts.conversations }]
    }),
    makeNode({
      id: 'runs',
      kind: 'run',
      label: 'Runs & RUN.md',
      layer: 'storage',
      source: 'filesystem',
      state: input.runs.total > 0 ? (input.runs.blocked > 0 ? 'warning' : 'healthy') : 'inactive',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['observability'],
      order: 2,
      evidence: { source: 'filesystem', ref: '~/.claude/runs/<session>/<workspace>/RUN.md' },
      roleDesc: 'Le journal de chaque unité de travail : statut, DoD, évènements, défauts.',
      observed: 'Le statut et les compteurs de chaque run vivant.',
      notObserved: 'Le contenu intégral d’un RUN.md n’est pas dumpé ici.',
      references: ['main/dashboards/runs-scan.ts', 'main/dashboards/runs.ts'],
      metrics: [
        { label: 'Runs', value: input.runs.total },
        { label: 'Bloqués', value: input.runs.blocked }
      ]
    }),

    /* ---------- Observabilité (rose) ---------- */
    makeNode({
      id: 'cost',
      kind: 'cost',
      label: 'Coût & budget',
      layer: 'observability',
      source: 'ipc',
      state: input.budget.alert ? 'warning' : 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['observability'],
      order: 0,
      evidence: { source: 'ipc', ref: 'main/dashboards/cost.ts · CostAggregator' },
      roleDesc:
        'Agrège les tokens/coût réels par tour, par rôle et par provider ; alerte au seuil.',
      observed: 'Le coût cumulé et le ratio budget.',
      notObserved: 'Le coût interne du provider hors tokens remontés.',
      references: ['main/dashboards/cost.ts'],
      metrics: [
        { label: 'Dépensé', value: `$${input.budget.spent.toFixed(4)}` },
        {
          label: 'Budget',
          value: input.budget.budget === null ? 'non plafonné' : `$${input.budget.budget}`
        }
      ]
    }),
    makeNode({
      id: 'trust',
      kind: 'trust',
      label: 'Confiance des juges',
      layer: 'observability',
      source: 'ipc',
      state: input.counts.trustModels > 0 ? 'healthy' : 'inactive',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['observability'],
      order: 1,
      evidence: { source: 'ipc', ref: 'main/trust/ledger.ts · TrustLedger' },
      roleDesc: 'Calibre chaque modèle-juge contre la vérité humaine (faux-green / faux-red).',
      observed: 'La précision par modèle-juge, une fois confirmée par un humain.',
      notObserved: 'La justesse d’un verdict non encore confirmé.',
      references: ['main/trust/ledger.ts'],
      metrics: [{ label: 'Modèles jugés', value: input.counts.trustModels }]
    }),
    makeNode({
      id: 'activity',
      kind: 'activity',
      label: 'Transcripts & habitudes',
      layer: 'observability',
      source: 'filesystem',
      state: input.counts.sessions > 0 ? 'healthy' : 'inactive',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['observability'],
      order: 2,
      evidence: { source: 'filesystem', ref: '~/.claude/projects/**/*.jsonl' },
      roleDesc:
        'Observatoire lecture seule des sessions Claude Code : outils utilisés, images consultées.',
      observed: 'Le nombre de sessions récentes et l’usage d’outils agrégé.',
      notObserved: 'Le contenu intégral n’est chargé qu’à la demande, hors de cette vue.',
      references: ['main/activity/transcripts.ts'],
      metrics: [{ label: 'Sessions', value: input.counts.sessions }]
    }),
    makeNode({
      id: 'trace',
      kind: 'trace',
      label: 'Ledger de traces',
      layer: 'observability',
      source: 'ipc',
      state: 'healthy',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['observability', 'pilotage'],
      order: 3,
      evidence: { source: 'ipc', ref: 'main/activity/ledger.ts · TraceLedger' },
      roleDesc: 'Chaque action d’agent (bus/pilot/orchestrate) laisse une trace consultable.',
      observed: 'La source, le nom et le succès de chaque action.',
      notObserved: 'Le détail est tronqué (200 c.) — pas un dump.',
      references: ['main/activity/ledger.ts']
    }),
    makeNode({
      id: 'questions',
      kind: 'question',
      label: 'Questions du modèle',
      layer: 'observability',
      source: 'ipc',
      state: input.pendingAuthority > 0 ? 'warning' : 'healthy',
      runtime: 'autowin-local',
      level: 'both',
      flows: ['observability'],
      order: 4,
      evidence: { source: 'ipc', ref: 'main/model-questions.ts · ModelQuestionHub' },
      roleDesc:
        'Quand le modèle doit trancher avec vous, il ouvre une question et attend votre choix.',
      observed: 'Les questions/décisions ouvertes.',
      notObserved: 'Votre réponse tant qu’elle n’est pas donnée.',
      references: ['main/model-questions.ts', 'main/authority/sas.ts']
    }),
    makeNode({
      id: 'kaizen',
      kind: 'kaizen',
      label: 'Kaizen (motifs récurrents)',
      layer: 'observability',
      source: 'filesystem',
      state: 'unknown',
      runtime: 'autowin-local',
      level: 'expert',
      flows: ['observability'],
      order: 5,
      evidence: { source: 'filesystem', ref: 'main/dashboards/kaizen.ts · gate-counters.jsonl' },
      roleDesc:
        'Agrège les motifs d’échec récurrents des gates pour proposer un audit comportemental.',
      observed: 'Les motifs récurrents quand un flux de compteurs est fourni.',
      notObserved: 'Aucun flux n’est sondé ici — état inconnu par défaut.',
      references: ['main/dashboards/kaizen.ts']
    })
  ]

  const edges: HarnessEdge[] = [
    // Chat — récit débutant : Vous → Autowin → modèle → (résultat)
    edge('you', 'autowin', 'invokes', ['chat', 'pilotage'], 'both', 'demande'),
    edge('autowin', 'orchestrator', 'routes', ['chat', 'orchestration'], 'both'),
    edge(
      'orchestrator',
      'model',
      'routes',
      ['chat', 'orchestration'],
      'beginner',
      'le modèle répond'
    ),
    edge('autowin', 'conversations', 'persists', ['chat'], 'both', 'sauvegarde'),
    // Orchestration
    edge('orchestrator', 'subagent', 'executes', ['orchestration'], 'both'),
    edge('orchestrator', 'scout', 'executes', ['orchestration'], 'expert'),
    edge('orchestrator', 'judge', 'invokes', ['orchestration'], 'both'),
    edge('subagent', 'model', 'routes', ['orchestration'], 'both'),
    edge('orchestrator', 'provider-claude', 'routes', ['orchestration'], 'expert'),
    edge('scout', 'provider-codex', 'routes', ['orchestration'], 'expert'),
    edge('provider-claude', 'model', 'executes', ['chat', 'orchestration'], 'expert'),
    edge('provider-codex', 'model', 'executes', ['orchestration'], 'expert'),
    // Configuration → runtime
    edge('roles', 'orchestrator', 'routes', ['orchestration'], 'both', 'binding'),
    edge('roles', 'subagent', 'routes', ['orchestration'], 'expert'),
    edge('roles', 'judge', 'routes', ['orchestration'], 'expert'),
    edge('roles', 'scout', 'routes', ['orchestration'], 'expert'),
    edge('kit', 'model', 'injects', ['chat', 'orchestration'], 'expert', 'bloc système'),
    edge('behaviour', 'orchestrator', 'injects', ['orchestration'], 'both', 'instructions'),
    edge('orchestrator', 'skills', 'invokes', ['orchestration'], 'both'),
    edge('loop', 'skills', 'invokes', ['loop'], 'expert'),
    edge('loop', 'orchestrator', 'invokes', ['loop'], 'expert'),
    edge('tools', 'pilot', 'invokes', ['pilotage'], 'expert'),
    // Gate & autorité
    edge('judge', 'gate', 'gates', ['orchestration', 'observability'], 'both'),
    edge('gate', 'runs', 'reads', ['observability'], 'both', 'lit RUN.md'),
    edge('gate', 'authority', 'gates', ['orchestration'], 'expert'),
    edge('hooks', 'gate', 'gates', ['observability'], 'expert'),
    edge('gate', 'questions', 'gates', ['observability'], 'both', 'décision AFK'),
    edge('questions', 'you', 'invokes', ['observability'], 'both', 'te demande'),
    // Pilotage
    edge('pilot', 'command-bus', 'invokes', ['pilotage'], 'expert'),
    edge('command-bus', 'autowin', 'executes', ['pilotage'], 'expert', 'conduit l’UI'),
    edge('pilot', 'model', 'routes', ['pilotage'], 'expert'),
    // Brain — lecture seule uniquement (jamais executes)
    edge('orchestrator', 'brain', 'reads', ['brain'], 'both', 'lecture seule'),
    edge('subagent', 'brain', 'reads', ['brain'], 'expert'),
    edge('judge', 'brain', 'reads', ['brain'], 'expert'),
    // Observabilité — les observateurs regardent le runtime
    edge('cost', 'model', 'observes', ['observability'], 'both'),
    edge('trust', 'judge', 'observes', ['observability'], 'expert'),
    edge('activity', 'autowin', 'observes', ['observability'], 'expert'),
    edge('trace', 'command-bus', 'observes', ['observability', 'pilotage'], 'expert'),
    edge('kaizen', 'hooks', 'observes', ['observability'], 'expert'),
    edge('orchestrator', 'runs', 'persists', ['observability'], 'both', 'attache RUN.md')
  ]

  // Caps stricts + payload borné.
  const cappedNodes = nodes.slice(0, MAX_HARNESS_NODES)
  const keptIds = new Set(cappedNodes.map((n) => n.id))
  const cappedEdges = edges
    .filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
    .slice(0, MAX_HARNESS_EDGES)

  const runtimes = [...new Set(cappedNodes.map((n) => n.runtime))]
  const providers = [...new Set(input.providers)].sort((a, b) => a.localeCompare(b))

  const snapshot: HarnessSnapshot = {
    generatedAt: input.generatedAt,
    focusModelId: modelLabel,
    nodes: cappedNodes,
    edges: cappedEdges,
    caps: {
      maxNodes: MAX_HARNESS_NODES,
      maxEdges: MAX_HARNESS_EDGES,
      nodeCount: cappedNodes.length,
      edgeCount: cappedEdges.length,
      truncated: nodes.length > MAX_HARNESS_NODES || edges.length > MAX_HARNESS_EDGES
    },
    providers,
    runtimes
  }

  assertHarnessInvariants(snapshot)
  return snapshot
}

/** Construit une arête bornée. */
function edge(
  from: string,
  to: string,
  kind: HarnessEdgeKind,
  flows: HarnessFlow[],
  level: HarnessLevel,
  label?: string
): HarnessEdge {
  return { id: `${from}~${kind}~${to}`, from, to, kind, flows, level, label }
}

/**
 * Invariants NON négociables du contrat. Lève si violés (le compose refuse de
 * rendre un graphe incohérent). Réutilisé par les tests.
 */
export function assertHarnessInvariants(snapshot: HarnessSnapshot): void {
  const ids = new Set(snapshot.nodes.map((n) => n.id))
  if (ids.size !== snapshot.nodes.length) throw new Error('Harnais : id de nœud dupliqué')
  if (snapshot.nodes.length > snapshot.caps.maxNodes) throw new Error('Harnais : cap nœuds dépassé')
  if (snapshot.edges.length > snapshot.caps.maxEdges)
    throw new Error('Harnais : cap arêtes dépassé')

  const brainIds = new Set(snapshot.nodes.filter((n) => n.kind === 'brain').map((n) => n.id))
  for (const node of snapshot.nodes) {
    if (!ALLOWED_LAYERS.has(node.layer)) throw new Error(`Harnais : couche invalide ${node.layer}`)
    if (!ALLOWED_STATES.has(node.state)) throw new Error(`Harnais : statut invalide ${node.state}`)
    // Preuve/source obligatoire ; ref non vide sauf si explicitement dérivé.
    if (!node.evidence || !node.evidence.source) {
      throw new Error(`Harnais : preuve manquante sur ${node.id}`)
    }
    if (node.evidence.source !== 'derived' && !node.evidence.ref.trim()) {
      throw new Error(`Harnais : référence de preuve vide sur ${node.id}`)
    }
    // Le modèle et les providers ne sont jamais sondés → toujours unknown.
    if ((node.kind === 'model' || node.kind === 'provider') && node.state !== 'unknown') {
      throw new Error(`Harnais : ${node.id} ne peut être ${node.state} sans sonde`)
    }
    // Le Brain partagé est une connaissance, jamais un exécuteur SMB.
    if (brainIds.has(node.id) && node.runtime !== 'shared-brain') {
      throw new Error(`Harnais : le Brain ${node.id} doit rester shared-brain`)
    }
  }

  for (const e of snapshot.edges) {
    if (!ALLOWED_EDGE_KINDS.has(e.kind))
      throw new Error(`Harnais : verbe d’arête invalide ${e.kind}`)
    if (!ids.has(e.from) || !ids.has(e.to)) {
      throw new Error(`Harnais : arête orpheline ${e.id}`)
    }
    // Le Brain ne peut ni exécuter ni être exécuté : aucune arête executes ne le touche.
    if (e.kind === 'executes' && (brainIds.has(e.from) || brainIds.has(e.to))) {
      throw new Error(`Harnais : le Brain ne peut pas exécuter (${e.id})`)
    }
    // Toute arête touchant le Brain est une lecture.
    if ((brainIds.has(e.from) || brainIds.has(e.to)) && e.kind !== 'reads') {
      throw new Error(`Harnais : le Brain n’accepte que des lectures (${e.id})`)
    }
  }
}
