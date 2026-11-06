// Seuil de quorum pour l'agrégation par vote (fan-out multi-modèles du juge, cf. orchestrator.ts).
// Extrait de l'ancien panel.ts (dont les agrégateurs union/quorum n'étaient jamais appelés :
// l'orchestrateur fait l'union par synthèse LLM et le comptage de quorum inline).

/**
 * Quorum par défaut pour N juges PRÉVUS : majorité simple (⌈N/2⌉, minimum 1).
 */
export function defaultQuorumThreshold(votingGroups: number): number {
  return Math.max(1, Math.ceil(votingGroups / 2))
}

/**
 * UN JUGE EN PANNE RESTE COMPTÉ, ET NOMMÉ (2026-11-01, repris de Google EGM).
 *
 * Le seuil se calculait sur les seuls juges qui avaient répondu : sur 3 prévus, 2 pannes et 1 VALIDE
 * donnaient un seuil de 1, donc un vert sans un mot sur les absents. `skills/judge/SKILL.md:62`
 * exige le contraire : 1 relance, sinon INVALIDE, jamais un 100 silencieux. La crainte d'origine
 * reste juste, et elle est tenue ici : une panne n'est pas un refus du travail. Elle ne lance donc
 * aucune réparation, puisqu'un nouveau build ne ferait pas répondre les juges.
 *
 * Mesure du 2026-11-01 : 0 panel réel dans 683 `trace.json`. Le trou n'a jamais servi, d'où un
 * correctif court plutôt qu'un chantier.
 */
export interface VotesDuPanel {
  /** Les juges PRÉVUS pour ce passage, et non ceux qui ont répondu. */
  prevus: number
  valides: number
  /** Les juges qui ont répondu autre chose que VALIDE. */
  refus: number
  /** Le quorum composé du workflow, quand il y en a un. */
  quorumDuGraphe?: number
}

export interface IssueDuPanel {
  /**
   * `atteint` : le seuil est atteint. `refuse` : seuil manqué et un juge a nommé un défaut.
   * `incomplet` : seuil manqué, personne n'a refusé. `aucun` : aucun juge n'a répondu.
   */
  kind: 'atteint' | 'refuse' | 'incomplet' | 'aucun'
  seuil: number
  absents: number
  prevus: number
  valides: number
}

/** Le quorum du graphe borné aux juges prévus, sinon leur majorité simple. */
export function seuilDuPanel(prevus: number, quorumDuGraphe?: number): number {
  return quorumDuGraphe
    ? Math.min(Math.max(1, quorumDuGraphe), prevus)
    : defaultQuorumThreshold(prevus)
}

export function issueDuPanel(votes: VotesDuPanel): IssueDuPanel {
  const { prevus, valides, refus, quorumDuGraphe } = votes
  const seuil = seuilDuPanel(prevus, quorumDuGraphe)
  const absents = Math.max(0, prevus - valides - refus)
  const kind =
    valides >= seuil ? 'atteint' : refus > 0 ? 'refuse' : valides > 0 ? 'incomplet' : 'aucun'
  return { kind, seuil, absents, prevus, valides }
}

function phraseDesAbsents({ absents, prevus }: IssueDuPanel): string {
  return absents > 1
    ? `${absents} juges sur ${prevus} n'ont pas répondu`
    : `${absents} juge sur ${prevus} n'a pas répondu`
}

/** La ligne de trace d'un quorum atteint malgré un absent, ou rien s'ils ont tous répondu. */
export function noteDesAbsents(issue: IssueDuPanel): string | undefined {
  if (issue.kind !== 'atteint' || issue.absents === 0) return undefined
  return `${phraseDesAbsents(issue)} : le vote passe avec ${issue.valides} VALIDE (seuil ${issue.seuil}).`
}

/**
 * Le verdict agrégé que lit le contrôle final.
 *
 * L'absent d'un vote qui passe est une puce `OK: hors run` : aucune réparation ne le ramène, donc il
 * ne doit pas bloquer, mais il reste affiché. Une phrase contenant « défaut : » se lirait comme un
 * refus (`REJET_FORME_CONTRAT`, orchestrator.ts), d'où un texte qui évite ce mot.
 */
export function verdictDuPanel(
  issue: IssueDuPanel,
  votes: {
    /** Le verdict des membres qui ont validé, objections comprises (`verdictPanelValide`). */
    verdictValide: string
    /** Le texte des juges qui ont refusé. */
    raisons: readonly string[]
  }
): string {
  const { kind, absents, prevus, seuil, valides } = issue
  const decompte = `${valides}/${prevus} VALIDE, seuil ${seuil}`
  if (kind === 'aucun') return 'DEFAUT: aucun juge n’a répondu (tous en échec)'
  if (kind === 'incomplet') {
    return `DEFAUT: verdict incomplet — ${phraseDesAbsents(issue)} (${decompte})`
  }
  if (kind === 'refuse') {
    const manquants = absents > 0 ? ` ; ${phraseDesAbsents(issue)}` : ''
    const raisons = votes.raisons.length ? ` — ${votes.raisons.join(' | ')}` : ''
    return `DEFAUT: quorum non atteint (${decompte})${manquants}${raisons}`
  }
  if (absents === 0) return votes.verdictValide
  const puce = `- OK: hors run — ${phraseDesAbsents(issue)}`
  return votes.verdictValide.includes('\nOBJECTIONS:\n')
    ? `${votes.verdictValide}\n${puce}`
    : `${votes.verdictValide}\n\nOBJECTIONS:\n${puce}`
}

/** Le motif d'arrêt d'un panel en panne, ou rien quand un vert ou un refus a été rendu. */
export function motifPanneDesJuges(issue: IssueDuPanel): string | undefined {
  if (issue.kind !== 'incomplet' && issue.kind !== 'aucun') return undefined
  const constat =
    issue.kind === 'aucun'
      ? `aucun juge n'a répondu sur ${issue.prevus} prévus`
      : `verdict incomplet, ${phraseDesAbsents(issue)} et le seuil de ${issue.seuil} VALIDE n'est pas atteint`
  return `Réparation interrompue : ${constat}. C'est une panne des juges : le travail n'est pas en cause et un nouveau build n'y changerait rien. Relance le contrôle quand les modèles répondent.`
}
