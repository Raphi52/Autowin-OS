/**
 * Calculs du rond de compte et de sa legende (conv-904, 2026-10-12) — separes des composants
 * (anneau-activite.tsx) pour que le rechargement a chaud des composants reste possible.
 */
/** Verdict d'une action, tel que le rond et la legende le signalent. */
export type EtatArc = 'ok' | 'ko' | 'encours' | 'attente'

/**
 * L'EXCEPTION d'un groupe : la pastille au coin du rond de verre (« Rond de verre », conv-904 :
 * « le rond autour du chiffre est pas tres moderne il fait tache »). Un groupe tout reussi n'en a
 * pas — il reste silencieux. Sinon, la plus grave l'emporte : un echec avant une attente (une
 * decision ou une reprise t'attend), une attente avant ce qui tourne encore.
 */
export function exceptionDuGroupe(etats: readonly EtatArc[]): Exclude<EtatArc, 'ok'> | null {
  if (etats.includes('ko')) return 'ko'
  if (etats.includes('attente')) return 'attente'
  if (etats.includes('encours')) return 'encours'
  return null
}

/**
 * LA COULEUR DU ROND (conv-904, 2026-10-12 : « bof en vrai je preferais voir du vert et rouge la
 * jme rend pas compte si un truc a rate »). Le rond porte le verdict du GROUPE : vert si tout a
 * reussi, rouge si une action a echoue, ambre si une attend, la couleur du theme tant que ca tourne.
 * La pastille de 9 px qui portait seule l'echec ne se voyait pas.
 */
export function verdictDuRond(etats: readonly EtatArc[]): EtatArc {
  return exceptionDuGroupe(etats) ?? 'ok'
}

/**
 * Le VERDICT d'une action se lit « commande → code » (`npm test → exit 1`, voir
 * action-outcome-summary.ts). La capsule de verre le montre en DEUX cases : la commande, puis le
 * code, seul teinte en cas d'echec. Un verdict sans fleche (« succeeded », « rien retenu — … »)
 * reste une seule case.
 */
export function casesDuVerdict(label: string): { commande?: string; code: string } {
  const parties = label.split(' → ')
  if (parties.length === 2 && parties[0]!.trim() && parties[1]!.trim()) {
    return { commande: parties[0]!.trim(), code: parties[1]!.trim() }
  }
  return { code: label }
}

export type OutilDeLegende = { nom: string; etat: EtatArc }
export type GroupeDeLegende = OutilDeLegende & { fois: number }

/**
 * Regroupe les outils CONSECUTIFS de meme nom ET de meme verdict (« brain_read ×2 ») : l'ordre de
 * la legende reste celui des actions, et un echec n'est jamais fondu dans des reussites voisines.
 */
export function groupesDeLegende(outils: readonly OutilDeLegende[]): GroupeDeLegende[] {
  const groupes: GroupeDeLegende[] = []
  for (const outil of outils) {
    const dernier = groupes[groupes.length - 1]
    if (dernier && dernier.nom === outil.nom && dernier.etat === outil.etat) dernier.fois += 1
    else groupes.push({ ...outil, fois: 1 })
  }
  return groupes
}
