/**
 * Calculs du rond de compte et de sa legende (conv-904, 2026-10-12) — separes des composants
 * (anneau-activite.tsx) pour que le rechargement a chaud des composants reste possible.
 */
import { useState } from 'react'
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

/** L'effet joue sur le rond au moment ou le run se termine (conv-981). */
export type Atterrissage = 'reussi' | 'echec'

/**
 * LE VERDICT QUI « ATTERRIT » (conv-981, 2026-10-15) : l'effet d'un PASSAGE d'etat du bloc
 * d'orchestration (`data-state`). Seule la fin d'un run en cours atterrit : reflet s'il reussit,
 * secousse s'il echoue. Une interruption, un etat deja fini a l'ouverture du fil, ou un retour en
 * cours ne jouent rien. Le rond du COMPTE n'est pas un signal de fin : il vaut « ok » apres chaque
 * outil (`verdictDuRond`).
 */
export function atterrissageDuPassage(avant: string, apres: string): Atterrissage | null {
  if (avant !== 'running') return null
  if (apres === 'done') return 'reussi'
  if (apres === 'failed') return 'echec'
  return null
}

/** Les animations de l'atterrissage (anneau-activite.css) : seule leur fin efface la marque. */
export const ANIMATIONS_D_ATTERRISSAGE: readonly string[] = ['anneau-reflet', 'anneau-secousse']

/**
 * L'effet a poser sur le rond quand l'etat du bloc PASSE de « en cours » a la fin (conv-981). Le
 * premier etat vu est la reference : un fil ouvert sur un run deja fini ne joue rien. L'animation
 * CSS ne part qu'a l'APPARITION de l'attribut ; `effacer` le retire a la fin de l'effet. Sans cela,
 * l'effet REPARTIRAIT a chaque retour sur l'onglet Chat : une animation recommence quand son element
 * redevient affiche apres un `display: none`, ce que fait chaque vue au changement d'onglet. Etat
 * precedent tenu par le motif React « informations des rendus precedents » (setState pendant le
 * rendu), sur en double rendu.
 */
export function useAtterrissage(etat: string): [Atterrissage | null, () => void] {
  // fix-ok: src/renderer/src/components/anneau-activite-calcul.ts — marque laissee posee = reflet
  // rejoue a chaque retour sur le Chat (display:none -> flex relance les animations CSS).
  const [suivi, setSuivi] = useState<{ etat: string; atterrissage: Atterrissage | null }>({
    etat,
    atterrissage: null
  })
  const effacer = (): void =>
    setSuivi((courant) => (courant.atterrissage ? { ...courant, atterrissage: null } : courant))
  if (suivi.etat !== etat) {
    const suivant = { etat, atterrissage: atterrissageDuPassage(suivi.etat, etat) }
    setSuivi(suivant)
    return [suivant.atterrissage, effacer]
  }
  return [suivi.atterrissage, effacer]
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
