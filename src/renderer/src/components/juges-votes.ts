/**
 * VOTES DES JUGES d'un run — extraits du fil de sous-agents persisté (`runTrace`).
 *
 * Demande utilisateur du 2026-08-14 : « le panneau des juges, je veux voir leurs décisions et
 * pouvoir rentrer dans le détail de la même manière » (que les candidats du scout). Les votes
 * existent déjà : chaque juge d'un fan-out pousse un step `judge` avec `detail: 'vote: VALIDE|DEFAUT'`
 * et son verdict complet en texte ; un juge crashé pousse un step `failed` sans vote.
 *
 * Module PUR : il classe des steps déjà chargés, testable sans IPC.
 */

export interface StepDeRun {
  step?: string
  role?: string
  model?: string
  provider?: string
  text?: string
  detail?: string
  status?: string
  error?: string
  costUsd?: number
  durationMs?: number
}

export interface VoteJuge {
  /** Identité affichée en barre : le modèle d'abord, le provider en secours. */
  libelle: string
  vote: 'valide' | 'defaut' | 'echec'
  /** Le verdict COMPLET du juge — le détail dépliable. */
  texte: string
  costUsd?: number
  durationMs?: number
}

export function extraireVotesJuges(steps: readonly StepDeRun[]): VoteJuge[] {
  const votes: VoteJuge[] = []
  for (const step of steps) {
    if (step.step !== 'judge') continue
    // Le verdict AGRÉGÉ (synthétique, sans modèle) n'est pas un vote : c'est la somme des votes.
    const libelle = step.model || step.provider
    if (!libelle) continue
    if (step.status === 'failed') {
      votes.push({
        libelle,
        vote: 'echec',
        texte: step.error ? `Juge en échec : ${step.error}` : 'Juge en échec (aucun verdict rendu).',
        ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {})
      })
      continue
    }
    const detail = step.detail ?? ''
    const voteDetail = /vote:\s*(valide|defaut)/i.exec(detail)?.[1]?.toLowerCase()
    const texte = (step.text ?? '').trim()
    if (!voteDetail && !texte) continue
    const vote =
      (voteDetail as 'valide' | 'defaut' | undefined) ??
      (/^\s*valide/i.test(texte) ? 'valide' : 'defaut')
    votes.push({
      libelle,
      vote,
      texte: texte || `(verdict non textuel — ${detail || 'sans détail'})`,
      ...(step.costUsd !== undefined ? { costUsd: step.costUsd } : {}),
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {})
    })
  }
  return votes
}
