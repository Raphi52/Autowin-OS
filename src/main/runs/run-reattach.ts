import type { OrchestrationRunState } from './orchestration-state'

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

export function resumeActionFor(
  state: Pick<OrchestrationRunState, 'agents' | 'phaseOutputs'> | null | undefined,
  identityOf: ProcessIdentity
): ResumeAction {
  if (!state) return 'ignorer'
  if (runLiveness(state, identityOf).working) return 'rattacher'
  return 'relancer'
}
