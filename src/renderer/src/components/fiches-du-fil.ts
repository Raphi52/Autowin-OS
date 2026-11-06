/**
 * LES FICHES DE DEMANDE DANS L'INTERFACE (2026-11-02).
 *
 * L'app écrit un RUN.md léger par nouvelle demande, mais aucun écran ne les lisait :
 * « je vois dans mes dernières convs que ça a pas spécialement généré plus de run.md ». Elles se
 * montrent désormais dans le panneau RUN.md du fil, et s'ouvrent depuis un post-it du Board.
 */
import type { FicheDeDemande } from '../../../shared/fiche-de-demande'
import type { StatutDemande } from '../../../shared/carte-des-besoins'
import type { RunEntry } from './chat-view-types'

/** Une fiche se déplie comme un run : même `viewRun`, même lecture du fichier. */
export function runDeLaFiche(fiche: FicheDeDemande): RunEntry {
  return {
    subject: fiche.titre,
    session: fiche.conversationId,
    path: fiche.chemin,
    mtime: fiche.maj,
    summary: { status: fiche.statut, dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
  }
}

/** Le corps lisible : l'en-tête technique (`status:`, `session:`…) s'arrête à la première ligne vide. */
export function corpsDeLaFiche(contenu: string): string {
  const texte = contenu.replace(/\r\n/gu, '\n')
  const fin = texte.indexOf('\n\n')
  return fin < 0 ? texte : texte.slice(fin + 2)
}

/** La pastille de couleur de chaque état, avec les classes déjà thémées des runs. */
export const PASTILLE_DE_FICHE: Record<StatutDemande, string> = {
  prouve: 'st-ok',
  refuse: 'st-err',
  'en-cours': 'st-info',
  'sans-preuve': 'st-warn'
}

/**
 * RELAIS « ouvre cette fiche » : le Board demande, le chat honore quand il a chargé les fiches du fil
 * visé. À usage unique, et seulement pour CE fil : une demande restée en attente ne doit pas déplier
 * une fiche plus tard, dans un autre fil que l'utilisateur ouvre de lui-même.
 */
let ficheEnAttente: { conversationId: string; chemin: string } | null = null

export function demanderFicheAOuvrir(conversationId: string, chemin: string): void {
  ficheEnAttente = { conversationId, chemin }
}

/** Le chemin à déplier pour ce fil, consommé ; `null` si la demande vise un autre fil ou n'existe pas. */
export function reclamerFicheAOuvrir(conversationId: string): string | null {
  if (ficheEnAttente?.conversationId !== conversationId) return null
  const { chemin } = ficheEnAttente
  ficheEnAttente = null
  return chemin
}
