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
