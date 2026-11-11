/**
 * LE RAISONNEMENT S'ENREGISTRE AU FIL DU TOUR, pas seulement à sa clôture.
 *
 * Défaut vécu (2026-10-23 : « conv-1097 m'affiche raisonnement et rien dedans, ce bug
 * arrive souvent »). Le tour avait produit 6 657 caractères de pensée, tous présents
 * dans son journal de tour (`turn-journals/conv-1097/22595e17….jsonl`, 599 `reasoning-step`), puis
 * lancé un run de plus de 20 minutes. Le store de la conversation, lui, n'en avait RIEN : le
 * raisonnement n'y entrait qu'en une écriture, à la clôture du tour (`run-pilot-chat.ts`). Pendant
 * tout le tour, la pensée ne vivait donc QUE dans la mémoire de l'écran : un rechargement de la vue
 * (rechargement à chaud du code de l'interface, fenêtre rouverte) relisait le store et peignait un
 * bloc « Raisonnement » vide. Un tour qui échouait ou était coupé ne l'écrivait jamais.
 *
 * Règle : la pensée s'écrit par RAFALE. Dès qu'un événement autre que de la pensée arrive (une
 * action, une commande, du texte de réponse, la fin), la portion pas encore écrite part au store.
 * Une écriture par pause du modèle, pas une par fragment : 599 fragments, une poignée d'écritures.
 * Le réducteur du tour CONCATÈNE (`reduceChatTurn`, kind `reasoning`) : chaque écriture ne porte
 * donc que la portion NOUVELLE, jamais le texte entier, sinon la pensée se dédoublerait.
 */
export type EcrivainDeRaisonnement = {
  /** Reçoit chaque événement du pilote : accumule la pensée, l'écrit dès que le modèle passe à autre chose. */
  recevoir(event: { kind: string; text?: string }): void
  /** Écrit ce qui reste en attente (clôture, échec, coupure). Sans effet si rien n'attend. */
  vider(): void
  /**
   * La pensée générale du tour, écrite ou non : la trace causale et le journal de la conversation la lisent à la clôture.
   * Le décodage de l'image (skill look) a son propre écrivain (lookDecode) : il n'entre pas ici.
   */
  readonly texte: string
}

/**
 * `suite` : un texte est DÉJÀ stocké avant ce tampon (reprise d'un tour coupé). Sa première portion
 * continue ce texte, et son espace de tête sépare deux mots : il ne se retire pas.
 */
export function ecrivainDeRaisonnement(
  ecrire: (portion: string) => void,
  options: { suite?: boolean } = {}
): EcrivainDeRaisonnement {
  let accumule = ''
  let ecrit = 0
  const vider = (): void => {
    let portion = accumule.slice(ecrit)
    // Un reste fait seulement d'espaces ATTEND la suite : il sépare deux mots de deux rafales.
    if (!portion.trim()) return
    // La pensée stockée commence au premier caractère lisible, comme l'ancien `trim()` de clôture.
    // fix-ok: une suite de reprise garde son espace : sans cela « montre » et « Paris. » se collaient.
    if (ecrit === 0 && !options.suite) portion = portion.trimStart()
    ecrit = accumule.length
    ecrire(portion)
  }
  return {
    recevoir(event) {
      if (event.kind === 'reasoning') {
        if (event.text) accumule += event.text
        return
      }
      vider()
    },
    vider,
    get texte() {
      return accumule
    }
  }
}
