/**
 * LE CONTRAT ENTRE LA CARTE « LANCER EN N FILS » ET CHATVIEW (conv-1147, 2026-10-25).
 *
 * La carte vit dans le Markdown du fil, qui ne reçoit que du texte (`memo` sur des primitives). Elle
 * parle donc à ChatView par un événement de fenêtre, comme `autowin:prefill-conversation`.
 * ChatView répond par un second événement quand les fils sont ouverts, et la carte les nomme.
 * Fichier sans composant : il ne casse pas le rechargement à chaud (react-refresh).
 */
import type { FilPrevu } from '../../../shared/lancer-en-fils'

export const EVT_LANCER_EN_FILS = 'autowin:lancer-en-fils'
export const EVT_FILS_LANCES = 'autowin:fils-lances'

/** « fils » = un fil par groupe ; « ici » = toutes les tâches à la suite dans le fil d'origine. */
export type ModeDeLancement = 'fils' | 'ici'

export interface DemandeDeLancement {
  mode: ModeDeLancement
  plan: FilPrevu[]
  /** Le souvenir de la carte (`cleDuLancement`), rendu tel quel dans la confirmation. */
  cle: string
  /** Le fil du tour qui a rendu la carte. Absent = le fil affiché. */
  conversationId?: string
  /** La réponse qui porte la carte : la branche part du message de l'utilisateur qui la précède. */
  messageId?: string
  /**
   * Le TOUR de cette réponse : seul repère d'une réponse peinte en direct, qui n'a pas encore
   * d'identifiant de message tant que son fil n'est pas relu du disque (conv-1147).
   */
  turnId?: string
}

export interface FilLance {
  id: string
  titre: string
}

export interface ConfirmationDeLancement {
  cle: string
  mode: ModeDeLancement
  fils: FilLance[]
  /** Ce qui n'a pas pu partir, dit en clair (branche refusée, fil introuvable). */
  refus?: string[]
  /**
   * Refus AVANT toute dépense : aucun fil ouvert, aucun tour parti (réponse introuvable sur disque,
   * fil illisible, aucune branche créée). La carte le dit et rend ses boutons (conv-1147).
   */
  rienNestParti?: true
}

/** Ce que la carte retient d'elle-même : la demande partie, puis le reçu. */
export type SouvenirDeCarte =
  | Pick<ConfirmationDeLancement, 'mode' | 'fils' | 'refus' | 'rienNestParti'>
  | { mode: ModeDeLancement; envoye: true }

export function lireSouvenir(cle: string): SouvenirDeCarte | null {
  try {
    const brut = localStorage.getItem(cle)
    return brut ? (JSON.parse(brut) as SouvenirDeCarte) : null
  } catch {
    return null
  }
}

/**
 * Écrit par la carte (« Lancement demandé… ») ET par ChatView (le reçu). Mesuré à l'essai réel du
 * 2026-10-25 (conv-1147) : le passage en mosaïque démonte la carte du chat plein AVANT la
 * confirmation. Si seule la carte écrivait le reçu, personne ne l'écoutait, et la carte restait figée
 * sur « Lancement demandé… » au retour dans le fil.
 */
export function ecrireSouvenir(cle: string, souvenir: SouvenirDeCarte): void {
  try {
    localStorage.setItem(cle, JSON.stringify(souvenir))
  } catch {
    // Stockage plein ou refusé : une carte montée garde son état en mémoire jusqu'au prochain rendu.
  }
}

/** ChatView répond à la carte : le reçu est ÉCRIT d'abord, puis annoncé aux cartes montées. */
export function confirmerLancement(detail: ConfirmationDeLancement): void {
  const { cle, ...souvenir } = detail
  ecrireSouvenir(cle, souvenir)
  window.dispatchEvent(new CustomEvent(EVT_FILS_LANCES, { detail }))
}

/** Ce que le lancement a déjà fait, lu par le filet si une erreur imprévue l'interrompt. */
export interface SuiviDuLancement {
  /** Les branches déjà créées, dans l'ordre. */
  fils: FilLance[]
  /** Vrai dès que le lancement a répondu à la carte lui-même. */
  confirme: boolean
}

/**
 * LE DERNIER FILET de « Lancer en N fils » (défaut 3 du 1er juge). Une erreur imprévue doit quand
 * même répondre à la carte, sinon elle reste figée sur « Lancement demandé… », même après
 * redémarrage.
 *
 * Il nomme les fils DÉJÀ ouverts (2e relecture externe, conv-1147) : ils existent et travaillent,
 * la carte doit y mener. Et il se tait si le lancement avait déjà répondu : un reçu juste ne doit
 * pas être remplacé par un échec survenu après coup (une mise à jour d'affichage, par exemple).
 */
export async function lancerAvecFilet(
  lancer: (demande: DemandeDeLancement, suivi: SuiviDuLancement) => Promise<void>,
  demande: DemandeDeLancement
): Promise<void> {
  const suivi: SuiviDuLancement = { fils: [], confirme: false }
  try {
    await lancer(demande, suivi)
  } catch (erreur) {
    if (suivi.confirme) return
    const raison = erreur instanceof Error ? erreur.message : String(erreur)
    confirmerLancement({
      cle: demande.cle,
      mode: demande.mode,
      fils: [...suivi.fils],
      refus: [
        suivi.fils.length > 0
          ? `lancement interrompu après ${suivi.fils.length} fil(s) ouvert(s) (${raison})`
          : `lancement interrompu (${raison})`
      ]
    })
  }
}
