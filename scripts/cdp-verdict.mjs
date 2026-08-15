/**
 * LE VERDICT D'UNE SONDE — durci après une erreur mesurée.
 *
 * Le 2026-08-15, une sonde a rendu « VERDICT : OK » sur cette réponse : « Je ne peux pas encore
 * donner un nombre exact : la sonde disponible n'a pas retourné l'inventaire complet ». La tâche
 * (compter les `.test.ts` de `src/main`, réponse : 220) avait échoué, en 127 s, statut `completed`.
 * Le critère était « il y a du texte » — or un refus EST du texte. C'est un vert de surface.
 *
 * Trois barrières désormais, dans cet ordre de sévérité croissante :
 *   1. tour MUET — rien que des étiquettes `[a exécuté …]`, le défaut mesuré à 20,2 % du magasin ;
 *   2. tour qui REFUSE — l'agent dit lui-même qu'il n'a pas pu ; c'est un échec DÉCLARÉ, pas un doute ;
 *   3. tour qui ne PROUVE pas — quand la tâche a une vérité terrain, la réponse doit la contenir.
 *      C'est la seule barrière que ni un beau texte ni un statut `completed` ne peuvent franchir.
 */

/** Étiquettes d'action seules = tour muet. On les retire pour voir s'il reste une phrase. */
export function texteUtile(contenu) {
  return (contenu ?? '')
    .replace(/\[a exécuté[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const REFUS = [
  /je ne peux pas/i,
  /je n['’]ai pas pu/i,
  /impossible de/i,
  /n['’]a pas retourné/i,
  /sans pouvoir/i,
  /je ne suis pas en mesure/i,
  /pas encore (?:donner|certifier|conclure)/i
]

/** L'agent DIT qu'il n'a pas fait le travail. À croire sur parole : c'est lui qui sait. */
export function estUnRefus(texte) {
  return REFUS.some((motif) => motif.test(texte))
}

/**
 * Verdict d'une sonde. `attendu` est la VÉRITÉ TERRAIN calculée hors de l'app : sans elle, on ne
 * juge que le style de la réponse, jamais son exactitude.
 */
export function juger({ contenu, statut, attendu }) {
  const texte = texteUtile(contenu)
  if (!texte) return { ok: false, motif: 'TOUR MUET — aucune phrase, seulement des étiquettes' }
  if (estUnRefus(texte)) return { ok: false, motif: `REFUS DÉCLARÉ — « ${texte.slice(0, 90)}… »` }
  if (statut && statut !== 'completed') return { ok: false, motif: `statut ${statut}` }
  if (attendu !== undefined && attendu !== null) {
    const cible = String(attendu)
    if (!texte.includes(cible)) {
      return { ok: false, motif: `RÉPONSE FAUSSE — attendu « ${cible} », absent de la réponse` }
    }
  }
  return { ok: true, motif: attendu !== undefined ? `exact (${attendu})` : 'réponse utile' }
}
