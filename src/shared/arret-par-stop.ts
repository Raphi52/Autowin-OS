/**
 * LE BOUTON STOP DU CHAT, RECONNU PARTOUT OÙ SON ARRÊT EST RELU.
 *
 * Le Stop coupe le sous-agent en vol avec ce motif (`os:pilotChat:cancel`, `index.ts`). Le provider le
 * recopie dans son erreur sous la forme `[abort] <action> interrompu : <motif>`, émise par
 * `abortFailure` (`main/providers/abort-diagnostic.ts`) et par lui seul. La trace garde ce texte, et
 * c'est tout ce qu'une trace déjà écrite sait de l'arrêt.
 *
 * Mesuré le 2026-10-15 sur conv-955 : le sous-agent `clean` arrêté par Stop s'affichait « échec » en
 * rouge dans le graphe, comme une panne, alors que l'utilisateur l'avait coupé lui-même.
 *
 * Producteur et lecteur partagent CETTE constante : si le motif change, la reconnaissance suit.
 */
export const MOTIF_STOP_DU_CHAT = "arret demande par l'utilisateur (Stop du chat)"

/**
 * La signature entière de l'émetteur, pas le motif seul : une réponse de modèle qui CITE le motif
 * (un sous-agent qui enquête sur le Stop, conv-955) ne doit pas faire passer une vraie panne pour un
 * arrêt voulu. Le motif est comparé en entier, jusqu'à la fin de sa ligne.
 */
const SIGNATURE_D_ABORT = /\[abort\] [^\n]*? interrompu : ([^\n]*)/

/** Vrai si ce texte d'erreur est celui d'un appel coupé par le bouton Stop du chat. */
export function estArretParStop(texte: string | undefined): boolean {
  const motif = SIGNATURE_D_ABORT.exec(texte ?? '')?.[1]
  return motif?.trim() === MOTIF_STOP_DU_CHAT
}
