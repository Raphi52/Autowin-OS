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
  /**
   * Enregistre un message SANS reconstruire l'index.
   *
   * Mesure : reconstruire l'index a chaque tour de chat coutait ~90 ms synchrones dans le processus
   * principal d'Electron -- le poste DOMINANT, devant le scan lui-meme. Une pre-selection des
   * conversations candidates n'y avait presque rien change (108 -> 90 ms) : ce n'etait pas le bon
   * coupable. Les compteurs, eux, s'incrementent en O(mots du message).
   */
  ajouter(texte: string): void
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
  decoupe: (texte: string) => string[],
  /**
   * Comment reduire un mot a sa racine. Fourni par l'appelant, qui possede cette regle.
   *
   * La presence est comptee pour le mot ENTIER **et** pour sa racine. Sans les deux, la rarete d'un
   * mot entier valait toujours 1 (absent de l'index, donc « inconnu, on ne penalise pas ») -- et la
   * ponderation par le mot rencontre ne discriminait rien du tout. Un index qui repond 1 a chaque
   * question est plus trompeur qu'un index absent : il a l'air de fonctionner.
   */
  racineDe: (mot: string) => string = (mot) => mot
): IndexVoisinage {
  const paires = new Map<string, Map<string, number>>()
  /** Oublie le calcul garde d'un mot : renseigne par `absorber`, defini plus bas. */
  let retenusOublier: (mot: string) => void = () => {}
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
  const absorber = (texte: string): void => {
    if (!texte || texte.length > LONGUEUR_UTILE) return
    const mots = [...new Set(decoupe(texte).filter((mot) => !TROP_COURANTS.has(mot)))].slice(0, 30)
    messagesVus += 1
    for (const mot of mots) {
      presence.set(mot, (presence.get(mot) ?? 0) + 1)
      const rac = racineDe(mot)
      if (rac !== mot) presence.set(rac, (presence.get(rac) ?? 0) + 1)
      // Les voisins de ce mot changent : on oublie le calcul garde, il sera refait a la demande.
      retenusOublier(rac)
      retenusOublier(mot)
    }
    const racines = [...new Set(mots.map(racineDe))]
    for (let i = 0; i < racines.length; i++) {
      for (let j = i + 1; j < racines.length; j++) {
        compter(racines[i], racines[j])
        compter(racines[j], racines[i])
      }
    }
  }
  for (const texte of messages) absorber(texte)
  /*
   * Les voisins sont calcules A LA DEMANDE et gardes, plutot que tous d'avance.
   *
   * Tout pre-calculer obligeait a TOUT refaire des qu'un message arrivait. Une demande n'interroge
   * qu'une poignee de mots : les calculer a l'appel coute un tri sur une seule ligne de compteurs,
   * et un message ajoute n'invalide que les mots qu'il touche.
   */
  const retenus = new Map<string, string[]>()
  const voisinsDe = (mot: string): string[] => {
    const connu = retenus.get(mot)
    if (connu) return connu
    const ligne = paires.get(mot)
    const assez = ligne
      ? [...ligne.entries()]
          .filter(([, n]) => n >= RENCONTRES_MINIMUM)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, VOISINS_PAR_MOT)
          .map(([voisin]) => voisin)
      : []
    retenus.set(mot, assez)
    return assez
  }
  /*
   * La rarete, en logarithme : entre « present dans 1 message » et « present dans 10 », l'ecart
   * compte ; entre 500 et 510, non. Un mot INCONNU du corpus recoit 1 -- on ne le penalise pas
   * d'etre absent, c'est peut-etre le seul mot precis de la demande.
   */
  const rarete = (mot: string): number => {
    /*
     * UN MOT ECARTE POUR BANALITE N'EST PAS UN MOT INCONNU.
     *
     * `TROP_COURANTS` retire du corpus les mots qui « voisinent avec tout » -- ils ne sont donc jamais
     * comptes, et `rarete` leur rendait 1, la valeur du DOUTE, qui est aussi la valeur la plus
     * favorable. Le systeme declarait un mot non discriminant d'un cote et le sacrait le plus rare de
     * tous de l'autre. Mesure du 2026-08-26 sur un oracle de 120 cas : « dans » obtenait 9.0 au score
     * de porteur, juste derriere « projet » 9.3, alors qu'il ne porte aucun sujet.
     *
     * Ils recoivent donc le PLANCHER. Deterministe, sans budget : 114/120 -> 115/120. Le gain est
     * d'un cas, mais la correction est de SENS et non de reglage -- et elle vaut aussi pour le score,
     * ou ces mots pesaient bien plus qu'ils ne le meritaient.
     */
    if (TROP_COURANTS.has(mot)) return 0.05
    if (messagesVus === 0) return 1
    const vu = presence.get(mot)
    if (!vu) return 1
    const part = vu / messagesVus
    return Math.max(0.05, Math.min(1, Math.log(1 / part) / Math.log(messagesVus + 1)))
  }
  retenusOublier = (mot) => {
    retenus.delete(mot)
  }
  return { voisins: voisinsDe, rarete, ajouter: absorber }
}
