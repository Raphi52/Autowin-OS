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
  /** La première ligne du verdict (VALIDE / DEFAUT: raison) — l'essentiel, montré en tête du détail. */
  conclusion?: string
  /** SCORE: 0-100 déclaré par le juge (contrat étendu du 14/08). */
  score?: number
  /** Les puces OBJECTIONS: du contrat étendu — l'écart, la preuve manquante, où vérifier. */
  objections?: string[]
  costUsd?: number
  durationMs?: number
}

/** Lit les champs du contrat étendu (SCORE / OBJECTIONS) dans un verdict, tolérant à leur absence. */
export function lireContratEtendu(texte: string): {
  conclusion?: string
  score?: number
  objections?: string[]
} {
  const lignes = texte.split(/\r?\n/)
  const conclusion = lignes[0]?.trim() || undefined
  const scoreBrut = /(?:^|\n)\s*SCORE:\s*(\d{1,3})/i.exec(texte)?.[1]
  const score = scoreBrut !== undefined ? Math.min(100, Number(scoreBrut)) : undefined
  let objections: string[] | undefined
  const bloc = /(?:^|\n)\s*OBJECTIONS:\s*\n([\s\S]*)/i.exec(texte)?.[1]
  if (bloc) {
    objections = bloc
      .split(/\r?\n/)
      .map((ligne) => /^\s*-\s*(.+)$/.exec(ligne)?.[1]?.trim())
      .filter((item): item is string => Boolean(item))
    if (objections.length === 0) objections = undefined
  }
  return {
    ...(conclusion ? { conclusion } : {}),
    ...(score !== undefined && Number.isFinite(score) ? { score } : {}),
    ...(objections ? { objections } : {})
  }
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
      ...lireContratEtendu(texte),
      ...(step.costUsd !== undefined ? { costUsd: step.costUsd } : {}),
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {})
    })
  }
  return votes
}
