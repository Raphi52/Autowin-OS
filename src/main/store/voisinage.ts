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
  /**
   * Ce que vaut ce mot pour DISTINGUER une conversation d'une autre.
   *
   * Un mot present dans la moitie du corpus ne discrimine rien : le trouver n'apprend rien. Un mot
   * rare, si. Mesure sur le corpus reel (1190 conversations) : sans cette ponderation, les
   * conversations FOURRE-TOUT sortaient premieres sur n'importe quelle demande -- elles contiennent
   * un peu de tout, donc toujours quelque chose.
   *
   * Rend une valeur entre 0 et 1 : proche de 1 pour un mot rare, proche de 0 pour un mot partout.
   */
  rarete(mot: string): number
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
  // Dans combien de messages chaque mot apparait : la base de sa rarete.
  const presence = new Map<string, number>()
  let messagesVus = 0
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
    messagesVus += 1
    for (const mot of mots) presence.set(mot, (presence.get(mot) ?? 0) + 1)
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
  /*
   * La rarete, en logarithme : entre « present dans 1 message » et « present dans 10 », l'ecart
   * compte ; entre 500 et 510, non. Un mot INCONNU du corpus recoit 1 -- on ne le penalise pas
   * d'etre absent, c'est peut-etre le seul mot precis de la demande.
   */
  const rarete = (mot: string): number => {
    if (messagesVus === 0) return 1
    const vu = presence.get(mot)
    if (!vu) return 1
    const part = vu / messagesVus
    return Math.max(0.05, Math.min(1, Math.log(1 / part) / Math.log(messagesVus + 1)))
  }
  return { voisins: (mot) => retenus.get(mot) ?? [], rarete }
}
