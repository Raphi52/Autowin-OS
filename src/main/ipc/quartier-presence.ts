/**
 * LE CANAL DE LA PRÉSENCE DU POSTE (plan « Village commun », conv-1429, lot 1).
 *
 * La vue tient le registre des tanukis (`agents-quartier.ts`) ; elle envoie ici son instantané, au plus
 * toutes les 2 s et seulement quand il change. Le processus principal le relit champ par champ, le
 * filtre et l'écrit sur le partage (`quartier-presence.ts`). Trois canaux :
 *  - `os:quartier-presence:agents` : l'instantané (rien en retour, une écriture ne se fait pas attendre) ;
 *  - `os:quartier-presence:partager` : l'interrupteur du poste (D6), rangé dans le réglage du Board ;
 *    rend l'état du dossier du Board, que les réglages affichent déjà ;
 *  - `os:quartier-presence:animal` (conv-1537) : l'animal des agents du poste, choisi dans les
 *    réglages de l'Accueil, rangé dans le réglage du Board et écrit dans `presence.json` ;
 *  - `os:quartier-presence:etat` : où et quand le fichier a été écrit, et le dernier échec ;
 *  - `os:quartier-presence:collegues` (lot 2) : la présence des AUTRES postes, relue sur le partage
 *    (`quartier-presence-collegues.ts`), validée champ par champ, au plus toutes les 4 s.
 */
import { basename } from 'node:path'
import { ipcMain } from 'electron'
import type { EtatDuDossierDuBoard } from '../../shared/board-dossier'
import {
  animalLisible,
  type EtatDeLaPresence,
  type PresencesDesCollegues
} from '../../shared/quartier-presence'
import type { DossierDuBoard } from '../board-dossier'
import { assertTrustedRendererSender } from '../ipc-senders'
import type { PublicationDeLaPresence } from '../quartier-presence'
import { creerLecteurDePresence } from '../quartier-presence-collegues'

export function registerQuartierPresenceIpc(deps: {
  publication: PublicationDeLaPresence
  dossierDuBoard: Pick<DossierDuBoard, 'etat' | 'choisirPartagePresence' | 'choisirAnimal'>
}): void {
  const { publication, dossierDuBoard } = deps
  // Même dossier et même poste que la relecture des Boards (`carte-des-besoins.ts`) : le nôtre est la
  // cible, ce sont nos propres tanukis, on ne le relit pas.
  const lecteur = creerLecteurDePresence({
    ou: () => {
      const { dossier, cible } = dossierDuBoard.etat()
      return dossier && cible ? { dossier, poste: basename(cible) } : null
    }
  })

  ipcMain.handle('os:quartier-presence:collegues', (event): Promise<PresencesDesCollegues> => {
    assertTrustedRendererSender(event, 'Présence du quartier')
    // `lire` ne lève jamais : un partage injoignable rend une liste vide avec l'erreur.
    return lecteur.lire()
  })

  ipcMain.handle('os:quartier-presence:agents', (event, agents: unknown): void => {
    assertTrustedRendererSender(event, 'Présence du quartier')
    // `recevoir` relit chaque champ (`agentsAPublierLisibles`) et ne lève jamais.
    publication.recevoir(Array.isArray(agents) ? agents : [])
  })

  ipcMain.handle(
    'os:quartier-presence:partager',
    async (event, actif: unknown): Promise<EtatDuDossierDuBoard> => {
      assertTrustedRendererSender(event, 'Présence du quartier')
      if (typeof actif !== 'boolean') return dossierDuBoard.etat()
      const etat = await dossierDuBoard.choisirPartagePresence(actif)
      // Coupé : `{ coupe: true, agents: [] }` part à la prochaine écriture permise (5 s au plus).
      publication.reglageChange()
      return etat
    }
  )

  ipcMain.handle(
    'os:quartier-presence:animal',
    async (event, animal: unknown): Promise<EtatDuDossierDuBoard> => {
      assertTrustedRendererSender(event, 'Présence du quartier')
      // `null` = revenir au défaut ; toute autre valeur inconnue est refusée sans rien changer.
      const choix = animal === null ? null : animalLisible(animal)
      if (animal !== null && !choix) return dossierDuBoard.etat()
      const etat = await dossierDuBoard.choisirAnimal(choix)
      // Les collègues voient le nouvel animal à la prochaine écriture permise (5 s au plus).
      publication.reglageChange()
      return etat
    }
  )

  ipcMain.handle('os:quartier-presence:etat', (event): EtatDeLaPresence => {
    assertTrustedRendererSender(event, 'Présence du quartier')
    return publication.etat()
  })
}
