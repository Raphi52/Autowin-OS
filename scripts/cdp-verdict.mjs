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

/**
 * LE JUGE DE FORME — ce que l'utilisateur REÇOIT, pas seulement ce que l'agent a trouvé.
 *
 * Correction majeure du 2026-08-15, sur son constat : « pour moi toutes tes sondes sont des échecs,
 * y'en a pas une qui a fini avec le bloc fait / à faire etc. — c'est pas du tout l'expérience
 * utilisateur que je veux offrir ». Il avait raison, et mes 10/10 puis 8/8 étaient des faux verts :
 * ils ne vérifiaient QUE l'exactitude du chiffre.
 *
 * Cas de référence, mot pour mot (`conv-1232`), que ce juge DOIT classer en échec :
 *
 *     [a exécuté find_in_files]
 *     Je lance la recherche exacte dans `src/shared` en excluant ensuite les fichiers `.test.ts`.
 *     **15 fichiers**.
 *
 * Le chiffre est juste et l'expérience est mauvaise : une étiquette technique brute, une annonce
 * d'intention devenue inutile une fois le résultat là, et aucun bloc de clôture.
 */
const DEFAUTS_DE_FORME = [
  {
    nom: 'étiquette technique brute',
    detecte: (t) => /\[a exécuté /.test(t),
    pourquoi: 'l’utilisateur lit un jeton interne, pas une phrase'
  },
  {
    nom: 'annonce d’intention après coup',
    detecte: (t) => /^\s*(je (vais|lance|dois)|lancement)/im.test(t),
    pourquoi: 'annoncer ce qu’on va faire n’a plus d’intérêt quand le résultat est là'
  },
  {
    nom: 'bloc de clôture absent',
    detecte: (t) => !(/✅|Fait\b/i.test(t) && /(Reste à faire|À faire|Recommand)/i.test(t)),
    pourquoi: 'ni ce qui a été fait, ni où on en est, ni la suite'
  }
]

/** Juge la FORME d'une réponse. Rend la liste des défauts, vide si l'expérience est correcte. */
export function jugerLaForme(contenu) {
  const texte = (contenu ?? '').trim()
  if (!texte) return [{ nom: 'réponse vide', pourquoi: 'rien à lire' }]
  return DEFAUTS_DE_FORME.filter((d) => d.detecte(texte)).map(({ nom, pourquoi }) => ({
    nom,
    pourquoi
  }))
}
