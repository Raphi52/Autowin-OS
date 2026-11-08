import { estMurDeQuota } from './reprise-quota'

/**
 * LE BOUTON STOP DU CHAT, RECONNU PARTOUT OÙ SON ARRÊT EST RELU.
 *
 * Le Stop coupe le sous-agent en vol avec ce motif (`os:pilotChat:cancel`, `index.ts`). Le provider le
 * recopie dans son erreur sous la forme `[abort] <action> interrompu : <motif>`, émise par
 * `abortFailure` (`main/providers/abort-diagnostic.ts`) et par lui seul. La trace garde ce texte, et
 * c'est tout ce qu'une trace déjà écrite sait de l'arrêt.
 *
 * Mesuré le 2026-10-15 : le sous-agent `clean` arrêté par Stop s'affichait « échec » en
 * rouge dans le graphe, comme une panne, alors que l'utilisateur l'avait coupé lui-même.
 *
 * Producteur et lecteur partagent CETTE constante : si le motif change, la reconnaissance suit.
 */
export const MOTIF_STOP_DU_CHAT = "arret demande par l'utilisateur (Stop du chat)"

/**
 * La signature entière de l'émetteur, pas le motif seul : une réponse de modèle qui CITE le motif
 * (un sous-agent qui enquête sur le Stop) ne doit pas faire passer une vraie panne pour un
 * arrêt voulu. Le motif est comparé en entier, jusqu'à la fin de sa ligne.
 */
const SIGNATURE_D_ABORT = /\[abort\] [^\n]*? interrompu : ([^\n]*)/

/**
 * Une ligne par modèle dans l'échec d'un lancement en parallèle (`describeFanoutFailure`,
 * `main/provider-failure-diagnosis.ts`) : « • claude (claude-opus-5) : <son erreur> ».
 */
const PUCE_D_UN_MODELE = /\n• /

function porteLeMotifDuStop(texte: string): boolean {
  return SIGNATURE_D_ABORT.exec(texte)?.[1]?.trim() === MOTIF_STOP_DU_CHAT
}

/**
 * Vrai si ce texte d'erreur est celui d'un appel coupé par le bouton Stop du chat.
 *
 * En parallèle, CHAQUE modèle doit avoir été coupé par le Stop : un modèle tombé sur son quota avant
 * le Stop d'un autre est une vraie panne, que « annulé » cacherait (forme réelle).
 */
export function estArretParStop(texte: string | undefined): boolean {
  if (!texte) return false
  const [, ...modeles] = texte.split(PUCE_D_UN_MODELE)
  return modeles.length > 0 ? modeles.every(porteLeMotifDuStop) : porteLeMotifDuStop(texte)
}

/**
 * LE MOTIF D'UN FIL ARRÊTÉ PAR UN AUTRE (`arreter_un_fil`, `main/conversations/arreter-un-fil.ts`).
 * Il dit QUI a coupé : sans cela, la trace du fil arrêté attribuerait le geste à son utilisateur.
 * Producteur et lecteur partagent cette forme, comme `MOTIF_STOP_DU_CHAT`.
 */
export function motifArreterUnFil(appelant: string, motif: string): string {
  return `arret demande par ${appelant} (arreter_un_fil) : ${motif}`
}

const MOTIF_ARRETER_UN_FIL = /^arret demande par \S+ \(arreter_un_fil\) : \S/

/**
 * Forme HISTORIQUE, relevée le 2026-11-06 : `AbortSignal.throwIfAborted()` relançait le motif nu, sans
 * passer par `abortFailure`, quand l'appel suivant partait sur un run déjà coupé. La ligne du modèle
 * est alors « claude (claude-opus-5-5) : arret demande par conv-N (arreter_un_fil) : … » : le motif
 * reconnu en ENTIER et en tête du message du modèle, jamais cité au milieu d'une phrase.
 */
const MODELE_ARRETE_SANS_SIGNATURE =
  /^\S+(?: \([^()\n]*\))? : arret demande par \S+ \(arreter_un_fil\) : \S/

function estArretVouluDUnModele(texte: string): boolean {
  const motif = SIGNATURE_D_ABORT.exec(texte)?.[1]?.trim()
  if (motif === MOTIF_STOP_DU_CHAT || (motif !== undefined && MOTIF_ARRETER_UN_FIL.test(motif)))
    return true
  return MODELE_ARRETE_SANS_SIGNATURE.test(texte)
}

/** Ce qui a coupé un appel sans que rien ne soit défectueux. */
export type InterruptionSansDefaut = 'limite-d-usage' | 'arret-voulu'

/**
 * Vrai motif d'un échec qui n'est PAS une panne : la limite d'usage du compte, ou un arrêt voulu
 * (bouton Stop du chat, `arreter_un_fil`). `undefined` dès qu'un seul modèle a vraiment échoué.
 *
 * Mesuré du 05 au 07/11/2026 : dix demandes notées « refusé » sur « aucun modèle n'a produit de
 * sortie », dont huit sur la limite de 5 heures du compte et deux coupées par un autre fil. Aucune
 * n'avait de défaut à corriger, et la revue des refus les prenait pour la première cause de ratés.
 *
 * En parallèle, CHAQUE modèle doit avoir été coupé ainsi (même règle que `estArretParStop`). La
 * limite l'emporte sur l'arrêt voulu : un modèle déjà sur sa limite avant le Stop d'un autre aurait
 * échoué de toute façon.
 */
export function interruptionSansDefaut(
  texte: string | undefined
): InterruptionSansDefaut | undefined {
  if (!texte) return undefined
  const [tete, ...modeles] = texte.split(PUCE_D_UN_MODELE)
  const causes = (modeles.length > 0 ? modeles : [tete]).map((ligne) =>
    estArretVouluDUnModele(ligne)
      ? 'arret-voulu'
      : estMurDeQuota(ligne)
        ? 'limite-d-usage'
        : undefined
  )
  if (causes.some((cause) => cause === undefined)) return undefined
  return causes.includes('limite-d-usage') ? 'limite-d-usage' : 'arret-voulu'
}
