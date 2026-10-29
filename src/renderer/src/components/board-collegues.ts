/**
 * LES POST-IT DES COLLÈGUES DANS LE BOARD (demande utilisateur du 2026-10-28, conv-1210).
 *
 * Demande : « fais afficher dans mon Board les post-it des collègues qui écrivent dans le même
 * dossier de la GED, avec leur nom sur chaque post-it et en lecture seule ». Le processus principal
 * relit leurs `board.json` (`src/main/board-collegues.ts`) ; ici, on les mêle à la carte AFFICHÉE :
 * un projet de plus par collègue et par projet, des fils dont l'identifiant est préfixé de son poste
 * (son `conv-12` n'est pas le nôtre), chaque demande marquée `collegue`.
 *
 * Seul l'affichage change : la carte calculée sur ce poste reste celle que le dossier du Board
 * recopie (sinon chaque poste republierait les post-it des autres), et les compteurs de l'en-tête
 * restent les nôtres.
 */
import type { BoardDUnCollegue } from '../../../shared/board-collegues'
import type {
  CarteDesBesoins,
  CollegueDeLaDemande,
  DemandeDeLaCarte,
  DemandeurAuCompte,
  DemandeurDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'

/** L'identifiant d'un fil de collègue dans la carte affichée : jamais confondu avec un des nôtres. */
export function idDuFilDeCollegue(poste: string, conversationId: string): string {
  return `${poste}/${conversationId}`
}

const comptesVides = (): Record<StatutDemande, number> => ({
  prouve: 0,
  refuse: 0,
  'en-cours': 0,
  'sans-preuve': 0
})

/**
 * La carte affichée : la nôtre, plus les post-it des collègues. Sans collègue, la carte rendue est
 * la MÊME (même référence), pour ne rien recalculer.
 */
export function carteAvecCollegues(
  carte: CarteDesBesoins,
  boards: readonly BoardDUnCollegue[]
): CarteDesBesoins {
  if (!boards.some((b) => b.postIts.length)) return carte
  const projets: ProjetDeLaCarte[] = [...carte.projets]
  const demandeurs: DemandeurAuCompte[] = [...carte.demandeurs]
  for (const board of boards) {
    if (!board.postIts.length) continue
    // Une personne par collègue : sa couleur de punaise et son bouton dans le filtre des personnes.
    const demandeur: DemandeurDeLaCarte = {
      cle: `collegue:${board.poste.toLowerCase()}`,
      nom: board.nom,
      origine: 'journal'
    }
    const parProjet = new Map<string, ProjetDeLaCarte>()
    let total = 0
    for (const p of board.postIts) {
      let projet = parProjet.get(p.projet.cle)
      if (!projet) {
        projet = {
          cle: `collegue:${board.poste}:${p.projet.cle}`,
          libelle: p.projet.libelle,
          nature: 'dossier',
          conversations: 0,
          demandes: [],
          runsBloques: [],
          comptes: comptesVides()
        }
        parProjet.set(p.projet.cle, projet)
      }
      projet.conversations += 1
      const id = idDuFilDeCollegue(board.poste, p.conversationId)
      for (const d of p.demandes) {
        const debut = d.date === undefined ? undefined : Date.parse(d.date)
        const collegue: CollegueDeLaDemande = {
          poste: board.poste,
          nom: board.nom,
          etage: p.etage,
          conversationId: p.conversationId,
          ...(d.workItems?.length ? { taches: d.workItems } : {})
        }
        const demande: DemandeDeLaCarte = {
          conversationId: id,
          conversationTitre: p.titre,
          rang: d.rang,
          ...(d.messageId ? { messageId: d.messageId } : {}),
          titre: d.titre,
          ...(d.texte ? { texte: d.texte } : {}),
          statut: d.statut,
          constat: d.constat,
          ...(debut !== undefined && Number.isFinite(debut) ? { debut } : {}),
          demandeur,
          collegue
        }
        projet.demandes.push(demande)
        projet.comptes[d.statut] += 1
        if (
          demande.debut !== undefined &&
          (projet.derniereActivite === undefined || demande.debut > projet.derniereActivite)
        )
          projet.derniereActivite = demande.debut
        total += 1
      }
    }
    projets.push(...parProjet.values())
    demandeurs.push({ cle: demandeur.cle, nom: demandeur.nom, demandes: total })
  }
  return { ...carte, projets, demandeurs }
}
