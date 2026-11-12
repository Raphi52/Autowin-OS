import type { traduireChatPanneaux } from '../textes-ecrans/chat-panneaux'

/**
 * L'état de connexion d'un fournisseur, vu par les menus de choix de modèle : le menu du chat
 * (OrchestratorModelSelector) et le menu déroulant d'Agent Studio (ModeleDeroulant) refusent tous
 * deux, au moment du choix, un modèle qu'on ne peut pas joindre. Une seule table, pour que les
 * deux menus refusent les mêmes états et les nomment pareil.
 */
export const CLE_DU_STATUT: Readonly<Record<string, Parameters<typeof traduireChatPanneaux>[0]>> = {
  authenticated: 'selecteur.statut.authentifie',
  expired: 'selecteur.statut.expire',
  'installed-untested': 'selecteur.statut.installeNonTeste',
  absent: 'selecteur.statut.nonConnecte',
  unknown: 'selecteur.statut.indetermine',
  standby: 'selecteur.statut.standby'
}

/** Les états sous lesquels un prompt ne partirait pas : le choix est refusé, pas juste décoré. */
export const STATUTS_BLOQUANTS: ReadonlySet<string> = new Set(['expired', 'absent', 'standby'])
