/**
 * RUN ZOMBIE — le vocabulaire commun de l'interruption.
 *
 * Un run d'orchestration tué avec l'app (fermeture, crash) laissait quatre surfaces se contredire :
 * le fil de chat attendait une réponse qui n'arriverait jamais, le graphe montrait des étapes « en
 * cours », le bureau isolé restait orphelin, et l'état persisté, lui, ne connaissait plus le run.
 * Aucune de ces surfaces ne portait l'invariant « un run non terminal correspond à un process
 * vivant » — chacune le DÉDUISAIT d'un checkpoint qui pouvait avoir disparu.
 *
 * Ce module ne porte que la PHRASE et sa reconnaissance : c'est le point de contact entre le store
 * de conversation (qui la pose au chargement) et le démarrage (qui ne doit pas la reposer). Une
 * troisième copie du texte recopiée à la main les ferait diverger sans aucune erreur visible.
 */

/** Avis rendu dans la conversation d'origine, une seule fois par tour. */
export function interruptionNotice(runId: string): string {
  return `run \`${runId}\` interrompu — l'application a été fermée`
}

/** L'avis est-il DÉJÀ dans ce texte ? Garde d'idempotence sur les redémarrages successifs. */
export function hasInterruptionNotice(text: string | undefined, runId: string): boolean {
  return Boolean(text?.includes(interruptionNotice(runId)))
}

/**
 * L'AUTRE MOITIÉ : le run n'était pas mort, il avait FINI.
 *
 * `hydrate` ne dispose que d'un discriminant — le tour est-il reprenable ? Absent de cette liste, il
 * recevait l'avis « interrompu » dans les DEUX cas : l'app tuée en plein travail, et le run allé au
 * bout pendant qu'elle était fermée. Le second cas laissait le fil MUET sur un travail pourtant
 * terminé et publié : `compteRenduNonVu` n'informe que le modèle au tour suivant, jamais l'utilisateur.
 *
 * On ne devine rien : l'issue est LUE dans l'état persisté du run (verdict, publication, commit).
 * Sans cette lecture, l'avis d'interruption reste le bon message.
 */
export interface FinishedRunOutcome {
  /** Identifiant du run tel qu'il est nommé partout ailleurs dans l'app. */
  runId: string
  verdict: string
  publication?: string
  publishedSha?: string
  task?: string
  fileCount?: number
}

const VERDICT_EN_CLAIR: Record<string, string> = {
  green: 'vert',
  red: 'rouge',
  cancelled: 'annulé',
  interrupted: 'interrompu'
}

const PUBLICATION_EN_CLAIR: Record<string, string> = {
  published: 'publié',
  complete: 'publié et nettoyé',
  held: 'retenu',
  blocked: 'bloqué',
  integrating: 'en cours d’intégration',
  pending: 'en attente de publication',
  'cleanup-pending': 'publié, nettoyage en attente',
  'not-requested': 'non publié'
}

/** Restitution rendue dans la conversation d'origine, une seule fois par tour. */
export function finishedRunNotice(outcome: FinishedRunOutcome): string {
  const morceaux = [
    `résultat : ${VERDICT_EN_CLAIR[outcome.verdict] ?? outcome.verdict}`,
    outcome.publication
      ? (PUBLICATION_EN_CLAIR[outcome.publication] ?? outcome.publication)
      : undefined,
    outcome.publishedSha ? `commit ${outcome.publishedSha.slice(0, 7)}` : undefined,
    outcome.fileCount ? `${outcome.fileCount} fichier(s) modifié(s)` : undefined,
    outcome.task ? `tâche : « ${outcome.task.slice(0, 160)} »` : undefined
  ].filter((morceau): morceau is string => Boolean(morceau))
  return `run \`${outcome.runId}\` terminé pendant que l'application était fermée — ${morceaux.join(' · ')}`
}

/** La restitution est-elle DÉJÀ dans ce texte ? Même garde d'idempotence que l'avis d'interruption. */
export function hasFinishedRunNotice(text: string | undefined, outcome: FinishedRunOutcome): boolean {
  return Boolean(text?.includes(finishedRunNotice(outcome)))
}
