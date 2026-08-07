import {
  loadOrchestrationStates,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'

/**
 * Un run est-il encore EN TRAIN de travailler ailleurs ?
 *
 * Les CLI sont lancés détachés : ils survivent à la mort de l'app et continuent d'écrire dans leur
 * journal. Au redémarrage, la reprise relançait le run sans jamais poser cette question — donc deux
 * agents pouvaient travailler en parallèle sur la même copie, en s'écrasant l'un l'autre. C'est le
 * risque le plus grave de la survie, et il se ferme ici.
 *
 * Le PID seul ne suffit pas : le système les recycle. On compare l'EMPREINTE du processus (heure de
 * démarrage + chemin), capturée au lancement — sinon un processus étranger ayant hérité du numéro
 * ferait croire que notre agent vit encore, et le travail ne reprendrait jamais.
 */

/** Empreinte d'un processus vivant, ou `undefined` s'il n'existe plus. */
export type ProcessIdentity = (pid: number) => string | undefined

export type AgentState =
  | 'vivant'
  | 'termine'
  | 'pid-recycle'
  /** Agent enregistré avant que son pid ne soit connu : on ne peut rien affirmer. */
  | 'inconnu'

export interface AgentVerdict {
  token: string
  state: AgentState
}

/** Verdict pour UN agent. Ne lance jamais : une sonde qui échoue vaut « on ne sait pas ». */
export function agentVerdict(
  agent: { token: string; pid?: number; identity?: string },
  identityOf: ProcessIdentity
): AgentVerdict {
  if (!agent.pid) return { token: agent.token, state: 'inconnu' }
  let current: string | undefined
  try {
    current = identityOf(agent.pid)
  } catch {
    return { token: agent.token, state: 'inconnu' } // sonde en échec : on n'invente pas un verdict
  }
  if (current === undefined) return { token: agent.token, state: 'termine' }
  // Sans empreinte capturée au lancement, on ne peut pas distinguer notre agent d'un pid recyclé.
  // On penche vers « vivant » : relancer par-dessus un agent réel coûte plus cher qu'attendre.
  if (!agent.identity) return { token: agent.token, state: 'vivant' }
  return { token: agent.token, state: current === agent.identity ? 'vivant' : 'pid-recycle' }
}

export interface RunLiveness {
  /** Au moins un agent travaille encore : NE PAS relancer ce run. */
  working: boolean
  agents: AgentVerdict[]
}

/** Verdict pour un run entier. Un seul agent vivant suffit à interdire la relance. */
export function runLiveness(
  state: Pick<OrchestrationRunState, 'agents'>,
  identityOf: ProcessIdentity
): RunLiveness {
  const agents = (state.agents ?? []).map((agent) => agentVerdict(agent, identityOf))
  return { working: agents.some((agent) => agent.state === 'vivant'), agents }
}

/**
 * Ce qu'il faut faire d'un run retrouvé au démarrage.
 *
 * `rattacher` — un agent travaille encore : on se rebranche sur son journal, on ne relance RIEN.
 * `relancer`  — plus personne ne travaille : comportement historique, reprise sur l'acquis.
 * `ignorer`   — rien à reprendre.
 */
export type ResumeAction = 'rattacher' | 'relancer' | 'ignorer'

/**
 * Depuis combien de temps le journal d'un agent n'a-t-il plus bougé ?
 *
 * `runLiveness` répond « ce processus EXISTE-t-il », ce qui n'est pas la même question que « cet
 * agent PRODUIT-il encore ». Un CLI bloqué sur un appel qui ne revient jamais garde son processus
 * vivant : le run est alors rattaché indéfiniment, aucune échéance ne le dépingle
 * (`deadlineAtMs` vit en mémoire dans l'ExecutionRuntime, et une reprise n'en arme aucune), et le
 * chat attend une réponse qui n'arrivera pas.
 *
 * Le journal est le seul témoin de production qu'on ait sur disque. `undefined` = on ne sait pas
 * (pas de journal, ou sonde en échec) — et on n'invente pas un verdict à partir d'une ignorance.
 */
export function agentSilenceMs(
  agent: { journalPath?: string },
  nowMs: number,
  lastWriteMs: (path: string) => number | undefined
): number | undefined {
  if (!agent.journalPath) return undefined
  let ecritA: number | undefined
  try {
    ecritA = lastWriteMs(agent.journalPath)
  } catch {
    return undefined // sonde en échec : on ne sait pas, on ne conclut pas
  }
  if (ecritA === undefined) return undefined
  return Math.max(0, nowMs - ecritA)
}

/**
 * Seuil au-delà duquel un agent vivant mais muet cesse d'être crédité d'un travail en cours.
 *
 * Généreux À DESSEIN : un agent peut légitimement rester silencieux pendant un appel outil long.
 * Se tromper en déclarant « muet » un agent qui travaille coûte un message inexact ; l'inverse — ce
 * qu'on avait — coûte une attente sans fin.
 */
export const SILENCE_TOLERE_MS = 10 * 60_000

/**
 * Cet agent produit-il encore, pour de bon ?
 *
 * Distinct de `runLiveness` : un run peut être VIVANT (processus présent, donc à ne surtout pas
 * relancer par-dessus) et pourtant NE PLUS PRODUIRE. Les deux réponses commandent des choses
 * différentes — la première décide s'il faut relancer, la seconde ce qu'on a le droit de DIRE à
 * l'utilisateur.
 *
 * Ne rend jamais `false` sur une ignorance : sans journal lisible, on répond `true` (comportement
 * historique) plutôt que d'annoncer un arrêt qu'on n'a pas constaté.
 */
export function runIsProducing(
  state: Pick<OrchestrationRunState, 'agents'> | null | undefined,
  nowMs: number,
  lastWriteMs: (path: string) => number | undefined,
  seuilMs = SILENCE_TOLERE_MS
): boolean {
  const silences = (state?.agents ?? []).map((agent) => agentSilenceMs(agent, nowMs, lastWriteMs))
  const mesures = silences.filter((silence): silence is number => silence !== undefined)
  if (!mesures.length) return true // rien de mesurable : on n'affirme pas un arrêt
  return mesures.some((silence) => silence < seuilMs)
}

function strandedTokenReservation(
  cap: number,
  used: number,
  startedCalls: number,
  strandedCalls: number,
  maxProviderCalls: number
): number {
  const available = Math.max(0, cap - used)
  let reservation = 0
  const firstStrandedIndex = Math.max(0, startedCalls - strandedCalls)
  for (let callIndex = firstStrandedIndex; callIndex < startedCalls; callIndex += 1) {
    const remainingCalls = Math.max(1, maxProviderCalls - callIndex)
    // Le compteur courant peut déjà contenir des appels réglés après le spawn orphelin. Utiliser le
    // cap complet comme numérateur reste donc une borne haute de sa réservation originelle.
    reservation += Math.ceil(cap / remainingCalls)
  }
  return Math.min(available, reservation)
}

export function resumeActionFor(
  state: Pick<OrchestrationRunState, 'agents' | 'phaseOutputs'> | null | undefined,
  identityOf: ProcessIdentity
): ResumeAction {
  if (!state) return 'ignorer'
  if (runLiveness(state, identityOf).working) return 'rattacher'
  return 'relancer'
}

/**
 * Réconcilie sur disque un appel resté « actif » parce que le process main est mort avant son
 * règlement. On ne libère le compteur que si CHAQUE agent enregistré est prouvé terminé/recyclé et
 * qu'il y a assez d'identités terminales pour couvrir tous les appels actifs. Au moindre doute, le
 * snapshot reste inchangé et le superviseur refusera la reprise plutôt que de doubler un provider.
 */
export function preparePersistedRunForRelaunch(
  root: string,
  runId: string,
  identityOf: ProcessIdentity,
  nowMs = Date.now()
): OrchestrationRunState | null {
  const state = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!state?.usage || state.usage.activeCalls <= 0) return state ?? null

  const liveness = runLiveness(state, identityOf)
  const terminalAgents = liveness.agents.filter(
    (agent) => agent.state === 'termine' || agent.state === 'pid-recycle'
  )
  const deathIsProven =
    liveness.agents.length >= state.usage.activeCalls &&
    terminalAgents.length === liveness.agents.length
  if (!deathIsProven) return state

  const strandedCalls = state.usage.activeCalls
  const limits = state.executionQuote?.limits
  const totalReservation = limits
    ? strandedTokenReservation(
        limits.maxTotalTokens,
        state.usage.totalTokens,
        state.usage.startedCalls,
        strandedCalls,
        limits.maxProviderCalls
      )
    : 0
  const freshReservation = limits
    ? strandedTokenReservation(
        limits.maxFreshTokens,
        state.usage.freshTokens,
        state.usage.startedCalls,
        strandedCalls,
        limits.maxProviderCalls
      )
    : 0
  const reconciled: OrchestrationRunState = {
    ...state,
    usage: {
      ...state.usage,
      failedCalls: state.usage.failedCalls + strandedCalls,
      activeCalls: 0,
      totalTokens: state.usage.totalTokens + totalReservation,
      freshTokens: state.usage.freshTokens + freshReservation,
      unpricedCalls: state.usage.unpricedCalls + strandedCalls,
      unmeteredCalls: state.usage.unmeteredCalls + strandedCalls,
      tokenCoverage: 'partial',
      stoppedReason: `${strandedCalls} appel(s) provider termine(s) sans reglement apres crash`
    },
    updatedAt: nowMs
  }
  saveOrchestrationState(root, reconciled)
  return reconciled
}

function pauseBeforeLivenessProbe(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    timer.unref?.()
  })
}

/**
 * Attend qu'un agent détaché se termine puis rend immédiatement la prochaine action. Sans cette
 * surveillance, une app rouverte pendant que le CLI vit encore reste bloquée jusqu'au redémarrage
 * suivant : elle s'est « rattachée » une fois, mais personne ne reprend la suite du workflow.
 */
export async function waitUntilRunCanResume(
  readAction: () => ResumeAction,
  pause: () => Promise<void> = pauseBeforeLivenessProbe
): Promise<Exclude<ResumeAction, 'rattacher'>> {
  for (;;) {
    const action = readAction()
    if (action !== 'rattacher') return action
    await pause()
  }
}
