// Parcours glouton (plan en nœuds parallèles, build puis juge/contrôle) — méthodes de la classe Orchestrator déplacées telles quelles depuis
// orchestrator.ts (conv-1508) ; elles s'exécutent avec `this` = l'instance, via les délégués de la classe.
import { randomUUID } from 'node:crypto'
import { clampAggregateForJudge, serializeEvidenceForJudge } from './evidence-digest'
import { CONTRAT_OBJECTIONS, verdictAvecObjectionsPortees } from './objections-juge'
import type { RoleBinding } from './roles'
import { resolvePhaseBinding } from './roles'
import { evaluateClosure } from './gates/stopgate'
import { fichiersEditesParLeRun } from './hooks/default-gate-hooks'
import { type IndependentLearningAttestation } from './outcome-learning-proposal'
import { type PipelinePhase, type NodePhase } from './skill-pipeline'
import { isMutationTask } from './task-mutation-classifier'
import { createMidPhaseSupervision } from './route-drift'
import { WORKFLOW_IS_A_TOOL_INSTRUCTION } from '../shared/persona'
import { projectContextBlock } from './context-files'
import { blocProfilUtilisateur } from './profil-utilisateur'
import { blocMemoireDeTete } from './memoire-de-tete'
import { blocLangueDeReponse } from './langue-reglage'
import type { ExecutionEvidence, PromptEnvelope, SendOptions } from './providers/types'
import { STYLE_TON } from './response-style'
import { CONSTITUTION } from './constitution'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { consigneBureauCache } from './consigne-bureau-cache'
import { evidenceDeLErreur } from './providers/evidence-portee-par-erreur'
import { describeFanoutFailure, explainRoleFailure } from './provider-failure-diagnosis'
import { runGreedy, type GreedyNode } from './greedy-scheduler'
import { GreedyTaskNode, OrchestrationPhase, OrchestrationResult, OrchestrationRuntimeSnapshot, OrchestrationStep, attestJudgeApprovedLearning, bindingDeRepliPourPhase, costOfTrace, evidenceSatisfiesTask, lireVerdictJuge, porterVersPhaseSuivante, workspaceIsolationNotice } from './orchestrator-contrats'
import type { Orchestrator } from './orchestrator'

/**
 * Chemin GREEDY (isolé du séquentiel) : exécute un DAG de sous-tâches en completion-driven.
 * Chaque sous-tâche = un sous-agent `build` lancé via `registry.send` ; l'ordonnanceur traite
 * chaque résultat DÈS son arrivée et dispatche les avals dont les dépendances viennent d'être
 * satisfaites, sans barrière. On agrège les livrables puis on passe UNE fois le juge + le gate.
 */
export async function runGreedyPipeline(
  this: Orchestrator,
  task: string,
  plan: GreedyTaskNode[],
  workCwd: string,
  runId: string,
  onStep?: (s: OrchestrationStep) => void,
  onPhase?: (p: OrchestrationPhase) => void,
  onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
  signal?: AbortSignal,
  collectedContext = '',
  bindingOverride?: RoleBinding,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
): Promise<OrchestrationResult> {
  const trace: OrchestrationStep[] = []
  const push = (s: OrchestrationStep): void => {
    trace.push(s)
    onStep?.(s)
  }
  const greedy = await this.runGreedyBuildPhase(
    task,
    plan,
    workCwd,
    runId,
    collectedContext,
    true,
    'build',
    push,
    onPhase,
    onDelta,
    signal,
    bindingOverride,
    runtimeSnapshot
  )

  const { valid, gate, learningAttestations } = await this.greedyJudgeAndGate(
    task,
    greedy.aggregate,
    greedy.evidence,
    workCwd,
    runId,
    push,
    onPhase,
    onDelta,
    signal,
    bindingOverride,
    runtimeSnapshot,
    // Ni en echec ni saute = livre. Une sous-tache absente de ces deux listes ne bloque rien.
    [...new Set([...greedy.failed, ...greedy.skipped])]
  )

  return {
    task,
    result: greedy.aggregate,
    valid,
    gateBlocked: gate.blocked,
    gateReasons: gate.reasons,
    costUsd: costOfTrace(trace),
    quote: this.deps.currentExecutionQuote?.(),
    phaseOutputs: greedy.orderedOutputs.map((output) => ({
      phase: 'build' as PipelinePhase,
      text: output.text
    })),
    ...(learningAttestations.length ? { learningAttestations } : {}),
    trace,
    failedTasks: greedy.failed,
    skippedTasks: greedy.skipped
  }
}

/** Juge + gate en mode greedy (une passe sur l'agrégat). Isolé du closure séquentiel. */
export async function greedyJudgeAndGate(
  this: Orchestrator,
  task: string,
  aggregate: string,
  evidence: ExecutionEvidence[],
  workCwd: string,
  runId: string,
  push: (s: OrchestrationStep) => void,
  onPhase?: (p: OrchestrationPhase) => void,
  onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
  signal?: AbortSignal,
  bindingOverride?: RoleBinding,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot,
  /**
   * Les sous-taches NOMMEES que cette passe n'a pas livrees (echec, ou saut en cascade).
   *
   * Ce chemin ne fait qu'UNE passe sur l'agregat : il n'a pas de boucle de reparation, donc bloquer
   * ici ne repare rien — cela rend l'echec VISIBLE au lieu d'annoncer une reussite. C'est le
   * defaut mesure le 2026-08-22 : `A` en echec, `C` sautee, et pourtant `valid: true` avec zero
   * raison.
   */
  travauxNonLivres: string[] = []
): Promise<{
  valid: boolean
  gate: ReturnType<typeof evaluateClosure>
  learningAttestations: IndependentLearningAttestation[]
}> {
  const { registry, roles, trust } = this.deps
  const cost = this.costFor(runId)
  // Le chemin greedy doit respecter le même ordre économique que le séquentiel : les oracles
  // locaux falsifiables passent AVANT le juge payant. S'ils réfutent le livrable, aucun appel
  // modèle ne peut rendre cette tentative verte.
  const evidenceOk = evidenceSatisfiesTask(task, evidence)
  const hookOutcome = await this.hooks.run('pre-green', {
    task,
    cwd: workCwd,
    verifyCmd: this.resolveVerifyCmd(workCwd),
    requireProof: isMutationTask(task),
    evidenceOkCount: evidence.filter((item) => item.ok).length,
    evidence,
    output: aggregate,
    editsByFile: fichiersEditesParLeRun(evidence, workCwd),
    fichiersTouchesAvantLeRun: this.fichiersSalesAuDemarrage
  })
  const preGate = evaluateClosure({
    // fix-ok: conv-835 tour 8641812d-6401-4129-a6b0-13a64228e0bc — meme raccourci que 0014ffca :
    // un hook bloquant AVEC sa raison forcait `red`, donc « Échec déjà déclaré » alors que rien ne
    // l'etait. Test orchestrator.greedy rouge avant / vert apres. Sans raison du hook : `red` garde.
    status:
      evidenceOk && !(hookOutcome.blocked && hookOutcome.reasons.length === 0) ? 'green' : 'red',
    dod: [{ checked: evidenceOk, hasContent: true }]
  })
  if (hookOutcome.blocked) {
    preGate.blocked = true
    preGate.reasons.push(...hookOutcome.reasons)
  }
  /**
   * ON N'INTERROMPT PLUS EN ROUTE — on CONSTATE, et on répare après coup.
   *
   * Ce site RENDAIT ici, avant le juge : le livrable n'était jamais jugé, aucune objection n'était
   * produite, et l'utilisateur recevait « PRÉ-GATE BLOQUÉ » sans rien à quoi se raccrocher. Un
   * blocage qui coupe la chaîne ne coûte pas seulement un run : il supprime le diagnostic qui
   * aurait permis de le réparer.
   *
   * Le run va donc jusqu'au bout. La clôture reste REFUSÉE — le motif du pré-gate est reporté et
   * fusionné au verdict du juge plus bas — mais elle l'est avec une CAUSE lisible. Aucun faux vert
   * n'est introduit : ce qui change, c'est qu'on sait pourquoi.
   */
  const motifsPreGate = preGate.blocked ? preGate.reasons : []
  if (motifsPreGate.length > 0) {
    push({
      step: 'gate',
      role: 'gate',
      detail: `Contrôle préalable en défaut (le travail continue, le juge tranchera) : ${motifsPreGate.join('; ')}`
    })
  }
  /**
   * SEULE exception au « on ne coupe plus » : un hook DÉTERMINISTE a déjà dit POURQUOI.
   *
   * Le juge sert à produire un diagnostic. Quand une vérification locale est rouge — les tests
   * échouent, et le hook le dit avec sa raison — la cause est déjà là, exacte et gratuite. Payer un
   * juge (~130k tokens mesurés ce soir) pour qu'il la redécouvre n'ajoute rien à ce que
   * l'utilisateur peut réparer.
   *
   * La règle est donc : on ne coupe jamais un run qui SORTIRAIT SANS CAUSE ; on s'autorise à ne pas
   * payer quand la cause est déjà acquise. Le run se termine dans les deux cas, avec son motif.
   */
  if (hookOutcome.blocked && hookOutcome.reasons.length > 0) {
    onPhase?.({ step: 'gate' })
    return { valid: false, gate: preGate, learningAttestations: [] }
  }

  const projectContext =
    projectContextBlock(this.deps.executionWorkspace) +
    blocProfilUtilisateur() +
    blocMemoireDeTete() +
    blocLangueDeReponse()
  const judgeBinding =
    bindingOverride ?? runtimeSnapshot?.roles.judge ?? roles.getBinding('judge')
  const judgeProvider = judgeBinding.provider
  const judgePrompt =
    `Tu es un juge outillé en lecture seule. Confronte le livrable aux preuves d'outil. ` +
    `Le livrable est le TEXTE agrégé (sous-tâches parallèles), PAS un RUN.md sur disque.\n` +
    `TÂCHE: ${task}\nRÉPONSE (agrégat des sous-tâches) : ${clampAggregateForJudge(aggregate)}\n` +
    `PREUVES OUTILS: ${serializeEvidenceForJudge(evidence)}\n` +
    `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".
Puis, APRÈS cette première ligne (sans jamais la modifier), complète pour l'utilisateur :
SCORE: <entier 0-100 — conformité du livrable au besoin, preuves à l'appui>
${CONTRAT_OBJECTIONS}`
  const messages = [{ role: 'user' as const, content: judgePrompt }]
  const parts = [
    this.phasePrompt('judge', true),
    { name: 'style', text: STYLE_TON },
    { name: 'projectContext', text: projectContext }
  ]
  const systemBlocks = parts
    .filter((p) => p.text)
    .map((p) => ({ name: p.name, chars: p.text.length }))
  let envelope: PromptEnvelope | undefined
  const opts: SendOptions = {
    system: parts.map((p) => p.text).join(''),
    systemBlocks,
    model: judgeBinding.model,
    reasoningEffort: judgeBinding.reasoningEffort,
    execution: this.executionOptions(
      workCwd,
      'read-only',
      runId,
      'judge',
      judgeProvider,
      false,
      judgeBinding.model
    ),
    signal,
    observePrompt: (observed) => {
      observed.systemBlocks = systemBlocks
      envelope = observed
    }
  }
  envelope = registry.describePrompt(judgeProvider, messages, opts, judgeBinding.model)
  envelope.systemBlocks = systemBlocks
  const judgeExecution = {
    phase: 'judge' as const,
    agentId: 'judge:greedy',
    taskId: 'judge:greedy',
    groupId: 'judge:single',
    dependencyIds: [] as string[],
    attemptId: randomUUID()
  }
  onPhase?.({
    step: 'judge',
    phase: 'judge',
    provider: judgeProvider,
    role: 'judge',
    model: judgeBinding.model,
    prompt: envelope,
    execution: judgeExecution
  })
  const startedAt = performance.now()
  const res = await this.sendWithRoleContext('jugement', 'judge', judgeProvider, opts.model, () =>
    registry.send(judgeProvider, messages, opts, (c) =>
      c.reasoning ? onDelta?.('judge', '', undefined, c.reasoning) : onDelta?.('judge', c.delta)
    )
  )
  if (res.usage) {
    cost.add({
      provider: res.provider ?? judgeProvider,
      role: 'judge',
      model: judgeBinding.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cacheReadTokens,
      cacheCreationTokens: res.usage.cacheCreationTokens,
      costUsd: res.usage.costUsd
    })
  }
  const verdictText = res.text ?? ''
  // Les preuves ont déjà passé le pré-gate : le juge tranche maintenant la substance.
  // UN SEUL lecteur : ce site testait `/^\s*valide/i` et jetait donc l'approbation d'un juge qui
  // n'ouvrait pas sa phrase par le mot. Cf. `lireVerdictJuge`.
  // Un VALIDE porteur d'objections concrètes n'est pas une clôture : il repart en réparation.
  const ok = lireVerdictJuge(verdictAvecObjectionsPortees(verdictText))
  // Rattachement au run et a la conversation : sans eux, aucun verdict n'est re-etiquetable
  // apres coup par l'humain, et calibration() reste a accuracy:null (186 lignes muettes).
  trust.record({
    judgeModel: judgeProvider,
    verdict: ok ? 'green' : 'red',
    runId,
    conversationId: this.costContextByRun.get(runId)?.conversationId
  })
  push({
    step: 'judge',
    provider: res.provider ?? judgeProvider,
    role: 'judge',
    model: res.model ?? judgeBinding.model,
    text: verdictText.trim(),
    thinking: res.thinking,
    tokens: res.usage ? res.usage.inputTokens + res.usage.outputTokens : undefined,
    costUsd: res.usage?.costUsd,
    usage: res.usage,
    prompt: envelope,
    detail: ok ? 'validé' : 'défaut',
    status: 'completed',
    durationMs: performance.now() - startedAt,
    execution: judgeExecution
  })
  onPhase?.({ step: 'gate' })
  // Pas de fausse DoD miroir du statut : elle faisait rendre au gate DEUX raisons pour UN SEUL
  // fait (le verdict du juge), en laissant croire à deux problèmes indépendants. Le gate reçoit
  // l'état réel — un statut — et rien d'inventé.
  // Le pré-gate n'a pas coupé la chaîne, mais son motif reste opposable : il rejoint ici le verdict
  // du juge. Un défaut de preuve constaté en amont ne devient pas vert parce que le juge, lui, a
  // trouvé le livrable convaincant — il s'AJOUTE, il ne se substitue pas.
  const okFinal = ok && motifsPreGate.length === 0
  const gate = evaluateClosure({
    status: okFinal ? 'green' : 'red',
    dod: [],
    travauxNonLivres
  })
  if (motifsPreGate.length > 0) gate.reasons.push(...motifsPreGate)
  push({
    step: 'gate',
    role: 'gate',
    // La RAISON du juge est ce qui manquait : sans elle, « bloqué » n'est pas actionnable. Elle est
    // déjà capturée dans `verdictText` — elle n'était simplement jamais remontée jusqu'ici.
    detail: gate.blocked
      ? `BLOQUÉ: ${gate.reasons.join('; ')} — verdict du juge: ${verdictText.trim().slice(0, 200) || '(réponse vide)'}`
      : 'clôture autorisée'
  })
  return {
    valid: okFinal,
    gate,
    learningAttestations: attestJudgeApprovedLearning(
      aggregate,
      ok,
      runId,
      res.provider ?? judgeProvider,
      res.model ?? judgeBinding.model,
      workCwd,
      verdictText
    )
  }
}

/** Exécute une tâche à travers le pipeline discipliné complet (appels réels). */
/**
 * Execute UNE phase en la DECOUPANT en sous-taches parallelisees (DAG completion-driven).
 *
 * Anciennement reservee a `build` : toute autre phase tournait en un seul sous-agent monolithique.
 * Mesure du 2026-07-28 (conv-75) : une phase d'exploration non decoupee a coute 10,90 $ en 11 min,
 * alors que le MEME travail, decoupe en 5 sous-audits cibles, a coute ~0,8 $ et ~1 min chacun.
 * Le decoupage n'est donc pas une specificite du build : c'est le levier de cout de TOUTE phase.
 *
 * `phase` est desormais un parametre : sans lui, les sous-agents d'un scout recevaient la consigne
 * de phase « build » (construis/modifie) au lieu de celle de leur phase reelle.
 */
export async function runGreedyBuildPhase(
  this: Orchestrator,
  task: string,
  plan: GreedyTaskNode[],
  workCwd: string,
  runId: string,
  phaseContext: string,
  withFoundation: boolean,
  phase: NodePhase,
  push: (s: OrchestrationStep) => void,
  onPhase?: (p: OrchestrationPhase) => void,
  onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
  signal?: AbortSignal,
  bindingOverride?: RoleBinding,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
): Promise<{
  aggregate: string
  orderedOutputs: { id: string; text: string }[]
  evidence: ExecutionEvidence[]
  failed: string[]
  skipped: string[]
}> {
  const { registry, roles } = this.deps
  const cost = this.costFor(runId)
  type ProviderAdmission = {
    state: 'probing' | 'ready' | 'blocked'
    settled: Promise<void>
    release: () => void
    signature?: string
    cause?: string
  }
  const providerAdmissions = new Map<string, ProviderAdmission>()
  const admitProviderCall = async (
    provider: string
  ): Promise<{ admission: ProviderAdmission; leader: boolean }> => {
    const existing = providerAdmissions.get(provider)
    if (existing) {
      if (existing.state === 'probing') await existing.settled
      return { admission: existing, leader: false }
    }
    let release = (): void => undefined
    const settled = new Promise<void>((resolve) => {
      release = resolve
    })
    const admission: ProviderAdmission = { state: 'probing', settled, release }
    providerAdmissions.set(provider, admission)
    return { admission, leader: true }
  }
  const structuralFailure = (
    error: unknown
  ): { provider: string; signature: string; cause: string } | undefined => {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as {
      structuralProviderFailure?: unknown
      provider?: unknown
      signature?: unknown
      causeText?: unknown
    }
    if (
      candidate.structuralProviderFailure !== true ||
      typeof candidate.provider !== 'string' ||
      typeof candidate.signature !== 'string'
    ) {
      return undefined
    }
    return {
      provider: candidate.provider,
      signature: candidate.signature,
      cause:
        typeof candidate.causeText === 'string'
          ? candidate.causeText
          : error instanceof Error
            ? error.message
            : String(error)
    }
  }
  const projectContext =
    projectContextBlock(this.deps.executionWorkspace) +
    blocProfilUtilisateur() +
    blocMemoireDeTete() +
    blocLangueDeReponse()
  // Une phase décomposée ne doit pas contourner son panel : chaque sous-tâche est exécutée par
  // tous les membres configurés, puis leurs sorties sont fusionnées. Sans panel (build/refine ou
  // topologie legacy vide), on conserve exactement le binding subagent historique. Un override de
  // tâche reste autoritaire et désactive le fan-out, comme dans le chemin non décomposé.
  const configuredBindings: RoleBinding[] = bindingOverride
    ? [bindingOverride]
    : this.resolvePhaseFanOut(phase, task, runtimeSnapshot)
  const subBindings =
    configuredBindings.length > 0
      ? configuredBindings
      : [bindingDeRepliPourPhase(phase, roles, runtimeSnapshot)]
  const fallbackProvider = subBindings[0].provider
  const sandbox = isMutationTask(task) ? 'danger-full-access' : 'read-only'
  const evidence: ExecutionEvidence[] = []
  const outputs: { id: string; text: string }[] = []
  const nodes: GreedyNode<{ text: string; evidence: ExecutionEvidence[] }>[] = plan.map(
    (node) => ({
      id: node.id,
      deps: node.deps,
      run: async (depResults) => {
        const depContext = Object.entries(depResults)
          .map(([id, result]) => `[dépendance ${id}]\n${porterVersPhaseSuivante(result.text)}`)
          .join('\n\n')
        const userContent = [phaseContext, depContext, `[sous-tâche ${node.id}] ${node.prompt}`]
          .filter(Boolean)
          .join('\n\n')
        // ORDRE = DU PLUS STABLE AU PLUS VOLATILE (cf. le commentaire détaillé du site fan-out) :
        // le cache de préfixe s'arrête au premier octet qui diffère, donc un bloc constant placé
        // après un bloc variable n'est jamais réutilisé. Contenu identique, ordre seul modifié.
        const parts = [
          { name: 'constitution', text: CONSTITUTION },
          { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
          { name: 'style', text: STYLE_TON },
          // Le droit de dévier n'est dit QUE si un graphe pilote : sinon la consigne parlerait
          // d'étapes qui n'existent pas, et inviterait à sortir d'un chemin qu'on ne suit pas.
          // Constant pour la durée du run.
          {
            name: 'workflowTool',
            text: this.workflowDuRun()?.graph ? WORKFLOW_IS_A_TOOL_INSTRUCTION : ''
          },
          // Constant par workspace.
          { name: 'projectContext', text: projectContext },
          // VARIABLE par phase.
          this.phasePrompt(phase, withFoundation),
          // VARIABLE par sandbox — le plus volatile, donc en dernier.
          // Vide quand le run tourne dans le dépôt de base : rien n'est payé en contexte.
          // VARIABLE par run : le bureau caché réservé à CE run (conv-618).
          { name: 'bureauCache', text: consigneBureauCache(runId) },
          {
            name: 'workspaceIsolation',
            text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
          }
        ]
        const systemBlocks = parts
          .filter((part) => part.text)
          .map((part) => ({ name: part.name, chars: part.text.length }))
        const messages = [{ role: 'user' as const, content: userContent }]
        const members = await Promise.all(
          subBindings.map(async (subBinding) => {
            const subProvider = subBinding.provider
            // Sans panel ni binding figé, la sous-tâche joue le binding du rôle : son effort suit
            // alors l'effort par défaut de l'étape. Les membres d'un panel ont déjà le leur.
            const phaseBinding =
              configuredBindings.length > 0
                ? resolvePhaseBinding(subBinding, phase)
                : this.resolveEtape(subBinding, phase, task, false)
            const memberKey = phaseBinding.model ?? subProvider
            let envelope: PromptEnvelope | undefined
            const options: SendOptions = {
              system: parts.map((part) => part.text).join(''),
              systemBlocks,
              model: phaseBinding.model,
              reasoningEffort: phaseBinding.reasoningEffort,
              ...(phaseBinding.advisorModel
                ? { claude: { advisorModel: phaseBinding.advisorModel } }
                : {}),
              execution: this.executionOptions(
                workCwd,
                sandbox,
                runId,
                phase,
                subProvider,
                true,
                phaseBinding.model
              ),
              signal,
              observePrompt: (observed) => {
                observed.systemBlocks = systemBlocks
                envelope = observed
              }
            }
            envelope = registry.describePrompt(subProvider, messages, options, phaseBinding.model)
            envelope.systemBlocks = systemBlocks
            const execution = {
              phase,
              agentId:
                subBindings.length === 1
                  ? `${phase}:${node.id}`
                  : `${phase}:${node.id}:${memberKey}`,
              taskId: node.id,
              groupId: `${phase}:greedy`,
              dependencyIds: [...node.deps],
              attemptId: randomUUID()
            }
            onPhase?.({
              step: 'exec',
              provider: subProvider,
              role: 'subagent',
              model: phaseBinding.model,
              reasoningEffort: phaseBinding.reasoningEffort,
              phase,
              // L'enveloppe est construite juste au-dessus : la ligne de pipeline montre le prompt
              // DES le demarrage (recidive « rien en preprompt », conv-587 du 2026-09-16).
              prompt: envelope,
              execution
            })
            const startedAt = performance.now()
            const { admission, leader } = await admitProviderCall(subProvider)
            if (admission.state === 'blocked') {
              const cause = admission.cause ?? `provider ${subProvider} bloqué`
              push({
                step: 'exec',
                provider: subProvider,
                role: 'subagent',
                model: phaseBinding.model,
                text: '',
                status: 'provider-blocked',
                error: cause,
                durationMs: performance.now() - startedAt,
                detail: `sous-tâche ${node.id}`,
                execution
              })
              return {
                ok: false as const,
                provider: subProvider,
                model: phaseBinding.model,
                text: '',
                evidence: [] as ExecutionEvidence[],
                agentId: execution.agentId,
                cause
              }
            }
            // Même supervision que partout : elle OBSERVE. Un membre qui boucle est SIGNALÉ, jamais
            // coupé — « plus aucune coupe de run » (doctrine utilisateur du 2026-08-19) vaut aussi
            // pour un membre de sous-tâche. Ce qu'on y perd est de l'argent, ce qu'on y gagne est
            // qu'aucun tour n'est jeté sans qu'un humain l'ait décidé.
            const supervision = createMidPhaseSupervision({
              forward: (delta) => onDelta?.('exec', delta)
            })
            try {
              const result = await registry.send(subProvider, messages, options, (chunk) => {
                supervision.onDelta(chunk.delta)
                if (chunk.reasoning) onDelta?.('exec', '', undefined, chunk.reasoning)
                // La NOTE remonte a l'interface, jamais au livrable : un battement d'outil dit
                // que le sous-agent travaille, il ne fait pas partie de sa reponse. Ce commentaire
                // l'annonçait mais le code ne la relayait pas (constaté en conv-1085). Les
                // sous-tâches tournent en parallèle sur la MÊME ligne : chacune la signe.
                if (chunk.status) {
                  onDelta?.(
                    'exec',
                    '',
                    `${subBindings.length > 1 ? `${node.id} · ${memberKey}` : node.id} · ${chunk.status}`
                  )
                }
              })
              const derive = supervision.trip()
              if (derive) {
                onDelta?.(
                  'exec',
                  `\n[dérive] sous-tâche ${node.id} (${memberKey}) : ${derive.detail} — signalé, rien n'a été interrompu\n`
                )
              }
              if (leader) {
                admission.state = 'ready'
                admission.release()
              }
              if (result.usage) {
                cost.add({
                  provider: result.provider ?? subProvider,
                  role: 'subagent',
                  model: phaseBinding.model,
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  cacheReadTokens: result.usage.cacheReadTokens,
                  cacheCreationTokens: result.usage.cacheCreationTokens,
                  costUsd: result.usage.costUsd
                })
              }
              push({
                step: 'exec',
                provider: result.provider ?? subProvider,
                role: 'subagent',
                model: result.model ?? phaseBinding.model,
                text: result.text,
                thinking: result.thinking,
                tokens: result.usage
                  ? result.usage.inputTokens + result.usage.outputTokens
                  : undefined,
                costUsd: result.usage?.costUsd,
                usage: result.usage,
                prompt: envelope,
                status: 'completed',
                durationMs: performance.now() - startedAt,
                evidence: result.executionEvidence,
                artifacts: result.artifacts,
                detail:
                  subBindings.length === 1
                    ? `sous-tâche ${node.id}`
                    : `sous-tâche ${node.id} · modèle ${memberKey}`,
                execution
              })
              supervision.dispose()
              return {
                ok: true as const,
                provider: result.provider ?? subProvider,
                model: result.model ?? phaseBinding.model,
                text: result.text,
                evidence: result.executionEvidence ?? [],
                agentId: execution.agentId,
                cause: undefined
              }
            } catch (error) {
              supervision.dispose()
              const structural = structuralFailure(error)
              if (structural && structural.provider === subProvider) {
                admission.state = 'blocked'
                admission.signature = structural.signature
                admission.cause = structural.cause
              }
              if (leader) {
                if (!structural || structural.provider !== subProvider) {
                  admission.state = 'ready'
                }
                admission.release()
              }
              const explained = explainRoleFailure(`sous-tâche ${node.id}`, 'subagent', {
                provider: subProvider,
                ...(phaseBinding.model ? { model: phaseBinding.model } : {}),
                message: error instanceof Error ? error.message : String(error)
              })
              push({
                step: 'exec',
                provider: subProvider,
                role: 'subagent',
                model: phaseBinding.model,
                text: '',
                status: 'failed',
                evidence: evidenceDeLErreur(error),
                error: explained,
                durationMs: performance.now() - startedAt,
                detail:
                  subBindings.length === 1
                    ? `sous-tâche ${node.id}`
                    : `sous-tâche ${node.id} · modèle ${memberKey}`,
                execution
              })
              return {
                ok: false as const,
                provider: subProvider,
                model: phaseBinding.model,
                text: '',
                evidence: [] as ExecutionEvidence[],
                agentId: execution.agentId,
                cause: explained
              }
            }
          })
        )
        const good = members.filter((member) => member.ok && member.text.trim())
        if (good.length === 0) {
          if (subBindings.length === 1 && configuredBindings.length === 0) {
            throw new Error(members[0].cause ?? `sous-tâche ${node.id} en échec`)
          }
          const explained = describeFanoutFailure(
            phase,
            'subagent',
            members.map((member) => ({
              provider: member.provider,
              ...(member.model ? { model: member.model } : {}),
              message: member.cause ?? 'sortie vide'
            }))
          )
          throw new Error(explained)
        }
        const nodeEvidence = good.flatMap((member) => member.evidence)
        let nodeText = good[0].text
        if (good.length > 1) {
          const orchBinding =
            runtimeSnapshot?.roles.orchestrator ?? roles.getBinding('orchestrator')
          const labelled = good
            .map(
              (member, index) =>
                `### Proposition ${index + 1} (modèle ${member.model ?? member.provider})\n${member.text}`
            )
            .join('\n\n')
          const synthMessages = [
            {
              role: 'user' as const,
              content:
                `Sous-tâche « ${node.id} » exécutée par ${good.length} modèle(s). ` +
                `Fusionne leurs sorties en une UNION DÉDUPLIQUÉE, sans perdre d'angle distinct ni re-décider.\n\n${labelled}`
            }
          ]
          // Ce site concatenait TROIS injections sans jamais les declarer : l'Observatory
          // recevait un system opaque de plusieurs milliers de caracteres qu'aucun bloc ne
          // revendiquait. Meme decomposition nommee que les autres sites d'envoi.
          const synthNodeParts = [
            { name: 'constitution', text: CONSTITUTION },
            { name: 'style', text: STYLE_TON },
            { name: 'projectContext', text: projectContext }
          ]
          let synthEnvelope: PromptEnvelope | undefined
          const synthSystemBlocks = synthNodeParts
            .filter((p) => p.text)
            .map((p) => ({ name: p.name, chars: p.text.length }))
          const synthOptions: SendOptions = {
            observePrompt: (observed) => {
              observed.systemBlocks = synthSystemBlocks
              synthEnvelope = observed
            },
            system: synthNodeParts.map((p) => p.text).join(''),
            systemBlocks: synthNodeParts
              .filter((p) => p.text)
              .map((p) => ({ name: p.name, chars: p.text.length })),
            contextBlocks: [
              { name: 'fusionPropositions', chars: synthMessages[0].content.length }
            ],
            model: orchBinding.model,
            reasoningEffort: orchBinding.reasoningEffort,
            execution: this.executionOptions(
              workCwd,
              'read-only',
              runId,
              phase,
              orchBinding.provider,
              true,
              orchBinding.model
            ),
            signal
          }
          const synthExecution = {
            phase,
            agentId: `${phase}:${node.id}:synthesis`,
            taskId: `${node.id}:synthesis`,
            groupId: `${phase}:greedy-synthesis`,
            dependencyIds: good.map((member) => member.agentId),
            attemptId: randomUUID()
          }
          synthEnvelope = registry.describePrompt(
            orchBinding.provider,
            synthMessages,
            synthOptions,
            orchBinding.model
          )
          synthEnvelope.systemBlocks = synthSystemBlocks
          onPhase?.({
            step: 'exec',
            provider: orchBinding.provider,
            role: 'orchestrator',
            model: orchBinding.model,
            reasoningEffort: orchBinding.reasoningEffort,
            phase,
            // Troisieme point d'annonce : la FUSION multi-modeles n'avait aucune enveloppe
            // (meme recidive « rien en preprompt », conv-587, saisie ts=1789550244094).
            prompt: synthEnvelope,
            execution: synthExecution
          })
          const synthStartedAt = performance.now()
          const synth = await this.sendWithRoleContext(
            `synthèse sous-tâche ${node.id}`,
            'orchestrator',
            orchBinding.provider,
            orchBinding.model,
            () =>
              registry.send(orchBinding.provider, synthMessages, synthOptions, (chunk) =>
                onDelta?.('exec', chunk.delta)
              )
          )
          if (synth.usage) {
            cost.add({
              provider: synth.provider ?? orchBinding.provider,
              role: 'orchestrator',
              model: orchBinding.model,
              inputTokens: synth.usage.inputTokens,
              outputTokens: synth.usage.outputTokens,
              cacheReadTokens: synth.usage.cacheReadTokens,
              cacheCreationTokens: synth.usage.cacheCreationTokens,
              costUsd: synth.usage.costUsd
            })
          }
          push({
            step: 'exec',
            provider: synth.provider ?? orchBinding.provider,
            role: 'orchestrator',
            model: synth.model ?? orchBinding.model,
            text: synth.text,
            thinking: synth.thinking,
            tokens: synth.usage ? synth.usage.inputTokens + synth.usage.outputTokens : undefined,
            costUsd: synth.usage?.costUsd,
            usage: synth.usage,
            status: 'completed',
            durationMs: performance.now() - synthStartedAt,
            evidence: synth.executionEvidence,
            artifacts: synth.artifacts,
            detail: `synthèse sous-tâche ${node.id}`,
            execution: synthExecution
          })
          nodeText = synth.text
        }
        evidence.push(...nodeEvidence)
        outputs.push({ id: node.id, text: nodeText })
        return { text: nodeText, evidence: nodeEvidence }
      }
    })
  )
  const run = await runGreedy(nodes, {
    concurrency: Math.min(
      this.deps.greedyConcurrency ?? 4,
      this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ?? Number.POSITIVE_INFINITY
    ),
    onSettled: (event) => {
      if (!event.skipped) return
      const skippedNode = plan.find((node) => node.id === event.id)
      push({
        step: 'exec',
        provider: fallbackProvider,
        role: 'subagent',
        text: '',
        status: 'failed',
        error: `sous-tâche ${event.id} sautée (dépendance en échec)`,
        detail: `sous-tâche ${event.id}`,
        execution: {
          phase,
          agentId: `${phase}:${event.id}`,
          taskId: event.id,
          groupId: `${phase}:greedy`,
          dependencyIds: [...(skippedNode?.deps ?? [])]
        }
      })
    }
  })
  const orderedOutputs = plan
    .map((node) => outputs.find((output) => output.id === node.id))
    .filter((output): output is { id: string; text: string } => Boolean(output))
  return {
    aggregate: orderedOutputs
      .map((output) => `[sous-tâche ${output.id}]\n${output.text}`)
      .join('\n\n'),
    orderedOutputs,
    evidence,
    failed: run.failed,
    skipped: run.skipped
  }
}
