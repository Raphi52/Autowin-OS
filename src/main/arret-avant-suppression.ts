/**
 * ARRÊTER CE QUI TOURNE DANS UN FIL AVANT DE LE SUPPRIMER — comme le bouton Stop.
 *
 * Constaté le 2026-10-22 (conv-1060) : le Stop (`os:pilotChat:cancel`, index.ts) coupe DEUX choses,
 * le run de développement du fil (`abortOrchestration`) et le tour de chat. La suppression depuis
 * l'écran ne coupait que le tour. Or le run n'écoute QUE son propre interrupteur (`commands.ts`,
 * `runTask(…, abortController.signal)`) et le tour l'attend sans écouter le sien (`agent-pilot.ts`,
 * `execCommandTolerante`) : le run allait au bout, payé en entier, et la suppression attendait sa
 * fin — le fil restait affiché tout ce temps. La suppression par l'agent (`remove_conversation`) ne
 * coupait rien du tout : tour et run continuaient sur un fil qui n'existait plus.
 *
 * Une seule fonction pour les quatre chemins (écran ou agent, un fil ou un lot) : aucun ne peut
 * rediverger du Stop sans que les tests `*.suppression-arret.test.ts` le voient.
 *
 * Les terminaux du fil s'arrêtent ici aussi (conv-1362, lot 3/3) : ce sont les seuls chemins où un
 * fil disparaît, et un shell laissé derrière n'aurait plus aucun écran pour le fermer.
 */
import type { ActiveChatTurns } from './active-chat-turns'
import { fermerTerminauxDuFil } from './terminal-integre'

/** Motif déjà lu comme arrêt VOULU (`terminalDuTour`, `task-manager/watchdog-suppression.ts`). */
export const MOTIF_SUPPRESSION = 'conversation-deleted'

export type TravauxDuFil = {
  /** Coupe le run de développement du fil : `AppCommandBus.abortOrchestration`. */
  couperLeRun: (conversationId: string, motif: string) => boolean
  /** Les tours de chat en vol. Absent (bus sans application autour) : seul le run est coupé. */
  tours?: Pick<ActiveChatTurns, 'abort' | 'abortAndWait'>
}

/**
 * Coupe le tour et le run du fil, puis attend la fin du tour — pour que ses dernières écritures ne
 * tombent pas APRÈS l'effacement des fichiers du fil.
 *
 * `depuisSonPropreTour` : l'agent supprime le fil dans lequel il travaille. Attendre la fin de ce
 * tour, c'est attendre la fin de l'appel en cours, qui attend cette attente : blocage sans fin. Le
 * tour est alors coupé sans être attendu.
 *
 * Limite connue : deux agents qui suppriment chacun le fil de l'autre au même instant s'attendent
 * mutuellement. Aucun chemin réel ne le fait aujourd'hui.
 */
export async function arreterLesTravauxDuFil(
  conversationId: string,
  { couperLeRun, tours }: TravauxDuFil,
  depuisSonPropreTour = false
): Promise<void> {
  fermerTerminauxDuFil(conversationId)
  // Le tour EN PREMIER : `abort` et `abortAndWait` marquent l'arrêt comme voulu de façon synchrone,
  // avant que le run coupé ne rende son rouge — sinon cette fin deviendrait un incident à analyser.
  if (depuisSonPropreTour) {
    tours?.abort(conversationId, MOTIF_SUPPRESSION)
    couperLeRun(conversationId, MOTIF_SUPPRESSION)
    return
  }
  const finDesTours = tours?.abortAndWait(conversationId, MOTIF_SUPPRESSION)
  // Le tour attend le run : sans cette coupure, `finDesTours` n'arrive qu'à la fin naturelle du run.
  couperLeRun(conversationId, MOTIF_SUPPRESSION)
  await finDesTours
}
