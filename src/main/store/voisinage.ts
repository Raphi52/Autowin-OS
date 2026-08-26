/**
 * LES MOTS QUI VONT ENSEMBLE, APPRIS DU CORPUS.
 *
 * Le lexique de familles (`synonymes.ts`) reglait les cas connus, mais restait une liste FINIE :
 * chaque mot nouveau demandait une ligne de code. Une couverture qui s'etend au cas par cas n'est
 * pas un savoir, c'est un rattrapage permanent.
 *
 * Le corpus, lui, PORTE ces liens. Quand quelqu'un ecrit « les badges, enfin les pastilles », les
 * deux mots se rencontrent ; quand ils designent la meme chose, ils reviennent dans les memes
 * phrases. Cette cooccurrence se mesure, et elle se met a jour toute seule a chaque message ajoute.
 *
 * CE QUE CELA NE FAIT PAS, dit precisement : un mot ABSENT du corpus entier reste introuvable. Mais
 * alors aucune conversation ne l'emploie -- il n'y a rien a retrouver. La lacune n'est pas dans la
 * recherche, elle est dans l'absence de matiere.
 */

/** Assez de rencontres pour que le lien soit un usage et non un hasard. */
const RENCONTRES_MINIMUM = 2

/** Au-dela, on n'apprend plus, on dilue : trois voisins par mot suffisent a elargir sans noyer. */
const VOISINS_PAR_MOT = 3

/**
 * Un message trop long n'est pas un CONTEXTE : c'est un sac.
 *
 * Dans un rapport de 50 000 caracteres, deux mots « se rencontrent » sans avoir de rapport. La
 * cooccurrence ne veut dire quelque chose que dans un voisinage etroit.
 */
const LONGUEUR_UTILE = 400

/** Mots trop courants pour rapprocher quoi que ce soit : ils voisinent avec tout. */
const TROP_COURANTS = new Set([
  'les',
  'des',
  'une',
  'que',
  'qui',
  'pour',
  'dans',
  'avec',
  'sur',
  'pas',
  'plus',
  'meme',
  'tout',
  'tous',
  'cette',
  'ces',
  'est',
  'sont',
  'fait',
  'faire',
  'comme',
  'mais',
  'donc',
  'quand',
  'alors',
  'enfin',
  'veux',
  'peux',
  'moi',
  'toi'
])

export interface IndexVoisinage {
  /** Les mots qui accompagnent habituellement celui-ci, du plus proche au moins proche. */
  voisins(mot: string): readonly string[]
}

/**
 * Construit l'index a partir des messages, une fois.
 *
 * Les paires sont comptees par message COURT : c'est la phrase qui rapproche, pas le document. Le
 * cout est un parcours du corpus -- paye a la premiere recherche, puis garde jusqu'a la prochaine
 * ecriture.
 */
export function construireVoisinage(
  messages: Iterable<string>,
  decoupe: (texte: string) => string[]
): IndexVoisinage {
  const paires = new Map<string, Map<string, number>>()
  const compter = (a: string, b: string): void => {
    let ligne = paires.get(a)
    if (!ligne) {
      ligne = new Map()
      paires.set(a, ligne)
    }
    ligne.set(b, (ligne.get(b) ?? 0) + 1)
  }
  for (const texte of messages) {
    if (!texte || texte.length > LONGUEUR_UTILE) continue
    const mots = [...new Set(decoupe(texte).filter((mot) => !TROP_COURANTS.has(mot)))].slice(0, 30)
    for (let i = 0; i < mots.length; i++) {
      for (let j = i + 1; j < mots.length; j++) {
        compter(mots[i], mots[j])
        compter(mots[j], mots[i])
      }
    }
  }
  const retenus = new Map<string, string[]>()
  for (const [mot, ligne] of paires) {
    const assez = [...ligne.entries()]
      .filter(([, n]) => n >= RENCONTRES_MINIMUM)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, VOISINS_PAR_MOT)
      .map(([voisin]) => voisin)
    if (assez.length > 0) retenus.set(mot, assez)
  }
  return { voisins: (mot) => retenus.get(mot) ?? [] }
}
