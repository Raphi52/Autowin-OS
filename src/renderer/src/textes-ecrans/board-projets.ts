import { tableDeTextes } from '../textes'

/**
 * TEXTES — LES PROJETS PARTAGÉS DU BOARD (demande du 2026-10-28, « dans le board je veux
 * qu'on puisse choisir quel CWD on partage »).
 *
 * Écrans couverts : `ProjetsPartagesDuBoard`, la liste à cocher des projets, et `RouageDuBoard`, le
 * bouton ⚙ posé à côté du bouton 📁 du Board qui l'ouvre.
 * Table à part de `board-et-maintenance.ts` : plusieurs fils écrivaient en même temps dans celle-là.
 * Mêmes règles, vérifiées par `tables.test.ts` : le français fait foi, l'anglais a les mêmes clés et
 * les mêmes `{valeurs}`.
 */
export const TEXTES_FR = {
  'projets.tous': 'Projets : tous',
  'projets.partie': 'Projets : {n}/{total}',
  'projets.aide':
    'Recopier : le projet part dans le dossier partagé du Board. Masquer sur ce poste : il disparaît de votre Board ici, sans toucher au dossier partagé.',
  'projets.titre': 'Projets recopiés dans le dossier',
  'projets.recopier': 'Recopier dans le dossier',
  'projets.masquer': 'Masquer sur ce poste',
  'projets.masquerAide':
    'Masqué sur ce poste : le projet disparaît de votre Board ici seulement ; le dossier partagé ne change pas.',
  'projets.masquesNote':
    'Un projet masqué reste dans cette liste : décochez « Masquer sur ce poste » pour le revoir.',
  'projets.tousEtFuturs': 'Tous, y compris les prochains',
  'projets.note': 'Un nouveau projet n’est pas recopié tant qu’il n’est pas coché.',
  'projets.demande': '{n} demande',
  'projets.demandes': '{n} demandes',
  'projets.retirer': 'Retirer {chemin} des dossiers de travail du Chat (et du Board)',
  'rouage.titre': 'Réglages du Board',
  'rouage.aide': 'Réglages du Board : Actualiser, ton nom, les projets recopiés dans le dossier'
}

export type CleBoardProjets = keyof typeof TEXTES_FR

export const TEXTES_EN: Record<CleBoardProjets, string> = {
  'projets.tous': 'Projects: all',
  'projets.partie': 'Projects: {n}/{total}',
  'projets.aide':
    'Copy: the project goes to the shared Board folder. Hide on this computer: it disappears from your Board here, without touching the shared folder.',
  'projets.titre': 'Projects copied to the folder',
  'projets.recopier': 'Copy to the folder',
  'projets.masquer': 'Hide on this computer',
  'projets.masquerAide':
    'Hidden on this computer: the project disappears from your Board here only; the shared folder does not change.',
  'projets.masquesNote':
    'A hidden project stays in this list: uncheck "Hide on this computer" to show it again.',
  'projets.tousEtFuturs': 'All, including future ones',
  'projets.note': 'A new project is not copied until it is checked.',
  'projets.demande': '{n} request',
  'projets.demandes': '{n} requests',
  'projets.retirer': 'Remove {chemin} from the Chat working folders (and from the Board)',
  'rouage.titre': 'Board settings',
  'rouage.aide': 'Board settings: Refresh, your name, the projects copied to the folder'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<CleBoardProjets, string>>> = {}

export const { useTextes: useTextesBoardProjets, traduire: traduireBoardProjets } = tableDeTextes(
  TEXTES_FR,
  TEXTES_EN
)
