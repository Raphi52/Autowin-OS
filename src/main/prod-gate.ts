/**
 * LE POINT DE PASSAGE — la seule pièce qui REFUSE réellement quelque chose.
 *
 * Les trois pièces précédentes décident chacune un morceau, sans rien empêcher :
 *   - `prod-guard.ts`      dit SI une cible est de la production ;
 *   - `prod-passphrase.ts` dit QUI autorise, et délivre un jeton borné ;
 *   - `prod-passphrase-ipc.ts` porte la saisie depuis l'écran de l'utilisateur.
 * Ce module les relie et rend un verdict qui ARRÊTE l'appelant. Tout outil qui touche la production
 * doit passer par ici, et par ici SEULEMENT : autant de points de passage que d'outils, c'est autant
 * d'occasions d'en oublier un.
 *
 * L'INTERRUPTEUR, ET POURQUOI IL EXISTE. La porte n'est ACTIVE que lorsqu'une phrase de passe est
 * définie. Ce n'est pas un contournement : c'est la seule façon d'installer la porte sans casser
 * l'existant. Aujourd'hui aucune base n'est déclarée dans la liste d'autorité, donc TOUTE cible est
 * « inconnue », donc bloquante — brancher la porte sans interrupteur rendrait `sql_query` inutilisable
 * dès la première consultation, y compris sur une maquette.
 *
 * LA TENSION EST ASSUMÉE, ET IL FAUT LA DIRE : `CoffreAutorisationProd` refuse tout quand aucune
 * phrase n'existe (l'absence de réglage ferme la porte), alors qu'ici l'absence de phrase DÉSACTIVE
 * la porte. Les deux sont cohérents une fois l'ordre compris — tant que l'utilisateur n'a pas défini
 * sa phrase, la fonctionnalité n'est pas installée et rien ne change ; dès qu'il l'a définie, elle
 * s'applique partout et plus rien ne passe sans jeton. Ce qui serait malhonnête, ce serait de laisser
 * croire qu'une protection est active alors qu'elle dort : c'est pourquoi `etat()` le dit, et pourquoi
 * un refus nomme toujours sa cause.
 *
 * CE QUI N'EST PAS ICI : l'écran. Le point de passage ne sait pas afficher une demande de mot de
 * passe — il rend un refus PORTEUR de la demande (`demande`), et l'appelant décide quoi en faire.
 * Un module de décision qui ouvrirait des fenêtres ne serait plus testable.
 */
import { classerCible, type AutoriteProd, type Cible, type NatureCible } from './prod-guard'
import type { CoffreAutorisationProd, Demande } from './prod-passphrase'
import type { NiveauProtectionProd } from '../shared/prod-protection'

export interface GesteProd {
  nature: NatureCible
  /** Le nom de la cible, tel que l'outil le connaît (ex. le nom de la base). */
  nom: string
  /** Ce que l'outil s'apprête à faire, en un mot stable (ex. `sql-read`, `sql-write`). */
  operation: string
  /** Le jeton obtenu par l'écran de saisie, s'il y en a un (niveau `phrase`). */
  jeton?: string
  /**
   * L'utilisateur vient de répondre « continuer » dans la fenêtre (niveau `confirmation`).
   * Ce booléen ne peut venir QUE du guichet, donc d'un clic réel : le modèle n'atteint pas ce
   * chemin, il ne peut pas le poser dans les arguments d'un outil.
   */
  confirme?: boolean
}

export type VerdictPorte =
  | { autorise: true }
  | {
      autorise: false
      motif: string
      /** Ce qu'il faut faire autoriser — à passer tel quel à la fenêtre. */
      demande: Demande & { raison: string }
      /** Ce que la fenêtre doit demander : une simple confirmation, ou la phrase de passe. */
      niveau: Exclude<NiveauProtectionProd, 'aucun'>
    }

export interface PorteProdPorts {
  /** La liste d'autorité courante (quelles cibles sont de la production). */
  autorite(): AutoriteProd
  /** Le coffre qui détient les jetons vivants. */
  coffre(): CoffreAutorisationProd
  /** `true` dès qu'une phrase de passe est définie (utile même quand le niveau ne l'exige pas). */
  phraseDefinie(): boolean
  /** Le niveau de protection choisi par l'utilisateur. Défaut : `confirmation`. */
  niveau(): NiveauProtectionProd
}

/** Identifiant lisible d'une cible, utilisé dans les jetons et à l'écran. */
export function nommerCible(cible: Cible): string {
  return `${cible.nature}:${cible.nom}`
}

export class PorteProd {
  constructor(private readonly ports: PorteProdPorts) {}

  /** Ce que l'interface peut afficher pour dire si la protection tourne ou dort. */
  etat(): { active: boolean; niveau: NiveauProtectionProd; raison: string } {
    const niveau = this.ports.niveau()
    if (niveau === 'aucun') {
      return {
        active: false,
        niveau,
        raison: 'Protection désactivée : les gestes de production partent sans rien demander.'
      }
    }
    if (niveau === 'phrase') {
      return this.ports.phraseDefinie()
        ? {
            active: true,
            niveau,
            raison: 'Chaque geste de production demande la phrase de passe.'
          }
        : {
            active: true,
            niveau,
            raison:
              "Aucune phrase de passe n'est enregistrée : les gestes de production seront refusés" +
              ' tant qu' +
              String.fromCharCode(39) +
              'elle n' +
              String.fromCharCode(39) +
              'est pas définie.'
          }
    }
    return {
      active: true,
      niveau,
      raison: 'Chaque geste de production ouvre une fenêtre de confirmation.'
    }
  }

  /**
   * LE VERDICT. Ordre des questions, et il compte :
   *   1. quel niveau l'utilisateur a-t-il choisi ? (`aucun` → on ne change rien au comportement)
   *   2. la cible est-elle de la production ? (le classifieur tranche, `inconnu` vaut prod)
   *   3. l'utilisateur a-t-il répondu ? — un clic « continuer », ou un jeton de phrase de passe.
   *
   * POURQUOI LA CONFIRMATION SUFFIT PAR DÉFAUT : le danger visé est le geste INVOLONTAIRE, celui
   * qu'un agent déclenche sans que personne ne l'ait voulu. Une fenêtre qui nomme la base et
   * l'opération l'arrête net. Contre quelqu'un de mal intentionné DEVANT le clavier, aucune fenêtre
   * ne protège — c'est le niveau `phrase` qui est fait pour ça, et il se choisit.
   *
   * Un jeton est consommé même quand il ne convient pas : c'est le coffre qui le brûle, pour qu'on
   * ne puisse pas tâtonner sans coût.
   */
  verifier(geste: GesteProd): VerdictPorte {
    const niveau = this.ports.niveau()
    if (niveau === 'aucun') return { autorise: true }

    const cible: Cible = { nature: geste.nature, nom: geste.nom }
    const verdict = classerCible(cible, this.ports.autorite())
    if (!verdict.estBloquant) return { autorise: true }

    const demande = { cible: nommerCible(cible), operation: geste.operation }
    const refus = (motif: string): VerdictPorte => ({
      autorise: false,
      motif,
      demande: { ...demande, raison: verdict.raison },
      niveau
    })

    if (niveau === 'confirmation') {
      return geste.confirme === true
        ? { autorise: true }
        : refus(`${verdict.raison} Confirmation requise avant d'agir sur cette cible.`)
    }

    if (!geste.jeton) {
      return refus(`${verdict.raison} Autorisation requise : saisis la phrase de passe.`)
    }
    const consommation = this.ports.coffre().consommer(geste.jeton, demande)
    return consommation.autorise ? { autorise: true } : refus(consommation.motif)
  }
}
