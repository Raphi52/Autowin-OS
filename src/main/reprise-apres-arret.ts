/**
 * REPRISE APRÈS UN TOUR ARRÊTÉ — la note qui explique les deux lignes que le CLI insère.
 *
 * Constat (conv-1142, 2026-10-25, 83 cas relevés dans les sessions du CLI du poste) : quand un tour
 * est coupé en plein travail (bouton Stop, fermeture de l'app, erreur) juste après un résultat
 * d'outil, la session du CLI se termine sans réponse de l'agent. À la reprise suivante (`--resume`),
 * le CLI insère lui-même un message méta « Continue from where you left off. » puis une réponse
 * SYNTHÉTIQUE « No response requested. » (modèle `<synthetic>`), juste avant le nouveau message.
 * L'agent la lit comme sa propre réponse et s'en excuse, ou invente une histoire de relance
 * (conv-798, tour 556f1923-e1d1-403b-b43b-56dbf9248428).
 *
 * Ces deux lignes vivent dans la session du CLI : l'app ne peut pas les retirer avant qu'elles
 * soient écrites. Elle SAIT en revanche, par le statut du message stocké, que le tour précédent
 * a été arrêté. La note part donc avec le message suivant, et SEULEMENT dans ce cas. Avant ce
 * module, la même explication était une phrase permanente de la constitution, relue à chaque tour.
 */
import type { ChatTurnStatus } from '../shared/chat-turn'

/**
 * Statuts d'un tour coupé avant sa fin. `cancelled` = bouton Stop (chat-turn-arret.ts),
 * `interrupted` = app fermée pendant le tour, `failed` = erreur en cours de tour. Dans les trois
 * cas, le processus du CLI a pu s'arrêter juste après un résultat d'outil.
 */
const STATUTS_ARRETES: ReadonlySet<ChatTurnStatus> = new Set<ChatTurnStatus>([
  'cancelled',
  'interrupted',
  'failed'
])

/** Contenus des messages de l'agent dont le tour s'est arrêté avant sa fin, lus dans le store. */
export function contenusDesToursArretes(
  stockes: ReadonlyArray<{ role: string; content?: unknown; status?: ChatTurnStatus }>
): Set<string> {
  const contenus = new Set<string>()
  for (const m of stockes) {
    if (
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.status &&
      STATUTS_ARRETES.has(m.status)
    )
      contenus.add(m.content)
  }
  return contenus
}

export const NOTE_REPRISE_APRES_ARRET =
  "Le tour précédent a été arrêté avant sa réponse (bouton Stop, fermeture de l'app ou erreur). " +
  'Si ta session montre juste avant ce message « Continue from where you left off. » puis ' +
  '« No response requested. », ces deux lignes ont été insérées par l’outil à la reprise : elles ne ' +
  "viennent ni de l'utilisateur ni de toi. Ne t'en excuse pas et n'invente pas de relance : si c'est " +
  "utile, dis que le tour précédent a été arrêté avant sa réponse, puis traite le message de l'utilisateur ci-dessous."

/**
 * La note, si le DERNIER tour de l'agent avant la demande courante s'est arrêté. Les consignes
 * envoyées pendant ce tour (`orientation`) sont sautées : elles ne closent pas le tour.
 */
export function noteRepriseApresArret(
  history: ReadonlyArray<{ role: string; orientation?: boolean; arrete?: boolean }>
): string {
  const derniere = history.length - 1
  if (derniere < 0 || history[derniere]?.role !== 'user') return ''
  for (let i = derniere - 1; i >= 0; i--) {
    const m = history[i]
    if (!m || (m.role === 'user' && m.orientation)) continue
    if (m.role === 'assistant') return m.arrete ? NOTE_REPRISE_APRES_ARRET : ''
    return ''
  }
  return ''
}
