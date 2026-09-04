/**
 * Le PROMPT SUIVANT : ce que l'utilisateur taperait, pas ce qu'on lui recommande.
 *
 * Le composer préremplissait son ghost-text avec la ligne « 👉 Recommandé » du bloc de clôture. Mais
 * cette ligne est un ÉTAT adressé au lecteur — « passer en terrain pour ce build » — alors qu'un
 * champ de saisie attend une CONSIGNE à la deuxième personne, autonome, prête à partir. Recopier
 * l'une dans l'autre donnait une phrase qui sonne faux et qu'il fallait réécrire à la main.
 *
 * Le modèle émet donc une ligne dédiée en fin de tour. Elle est INVISIBLE : le rendu la retire, et
 * elle ne sert qu'à remplir le champ en grisé — l'utilisateur voit le prompt une seule fois, là où il
 * va s'en servir.
 *
 * Même canal que `AUTOWIN_LESSON_V1` et `AUTOWIN_PARI_V1` : une ligne, un marqueur, aucun appel de
 * modèle supplémentaire. Et FAIL-OPEN de bout en bout : pas de ligne, ligne vide, pavé de 1200
 * caractères — on retombe sur l'ancien comportement au lieu de casser le composer.
 */

const MARQUEUR_PROMPT_SUIVANT = 'AUTOWIN_PROMPT_V1:'

/** Au-delà, ce n'est plus un prompt mais un paragraphe : on le borne au lieu de noyer le champ. */
const LONGUEUR_MAX = 600

const SAUT = String.fromCharCode(10)

/** Un préfixe du marqueur suffit à masquer la ligne pendant le streaming, caractère par caractère. */
const PREFIXES_PARTIELS = Array.from({ length: MARQUEUR_PROMPT_SUIVANT.length }, (_, index) =>
  MARQUEUR_PROMPT_SUIVANT.slice(0, index + 1)
)

const estOuvertureDeBloc = (ligne: string): boolean => ligne.trimStart().startsWith('```')

/**
 * Rend le DERNIER prompt émis, nettoyé de son markdown et borné. `null` s'il n'y en a pas —
 * l'appelant retombe alors sur la recommandation, donc rien ne régresse.
 */
export function extrairePromptSuivant(
  texte: string | undefined | null,
  demandeDuTour?: string
): string | null {
  if (!texte) return null
  let trouve: string | null = null
  let dansUnBloc = false
  for (const ligne of texte.split(SAUT)) {
    if (estOuvertureDeBloc(ligne)) {
      dansUnBloc = !dansUnBloc
      continue
    }
    // Un exemple du format cité dans un bloc de code n'est pas une consigne à exécuter.
    if (dansUnBloc) continue
    const debut = ligne.lastIndexOf(MARQUEUR_PROMPT_SUIVANT)
    if (debut < 0) continue
    const brut = ligne
      .slice(debut + MARQUEUR_PROMPT_SUIVANT.length)
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    // Une ligne réduite à de la ponctuation est un raté du modèle, pas un prompt.
    if (!/[\p{L}\p{N}]/u.test(brut)) continue
    trouve = brut.length > LONGUEUR_MAX ? brut.slice(0, LONGUEUR_MAX).trimEnd() : brut
  }
  if (trouve && estPromptDePublication(trouve, demandeDuTour)) return PROMPT_SALVAGE
  return trouve
}

/**
 * Retire la ligne technique du texte AFFICHÉ, y compris quand elle n'est encore qu'un préfixe du
 * marqueur : sans cela, le marqueur apparaîtrait lettre par lettre pendant le streaming avant de
 * disparaître d'un coup. En revanche une ligne citée dans un bloc de code est PRÉSERVÉE : là, c'est
 * de la documentation que l'utilisateur a demandé à voir.
 */
export function retirerLignePromptSuivant(texte: string): string {
  const lignes = texte.split(SAUT)
  const gardees: string[] = []
  let dansUnBloc = false
  for (const ligne of lignes) {
    if (estOuvertureDeBloc(ligne)) {
      dansUnBloc = !dansUnBloc
      gardees.push(ligne)
      continue
    }
    if (!dansUnBloc) {
      const nu = ligne.trim()
      if (nu.includes(MARQUEUR_PROMPT_SUIVANT)) continue
      if (PREFIXES_PARTIELS.includes(nu)) continue
    }
    gardees.push(ligne)
  }
  /*
   * On ne touche À RIEN d'autre. Une premiere version elaguait aussi les lignes vides finales, pour
   * faire propre : elle a casse onze tests de rendu, tous sur des blocs delimites, parce que ce rendu
   * compare l'alignement du DOM a celui de la source. Retirer une ligne est le mandat ; reformater le
   * texte des autres n'en fait pas partie.
   */
  return gardees.join(SAUT)
}

/**
 * PUBLICATION → /salvage. Un tour qui se termine par « commit, push, ouvre une PR » propose à
 * l'utilisateur de publier un travail dont personne n'a vérifié qu'il n'existait pas déjà ailleurs
 * (copies de travail isolées, remises de côté, branches jamais fusionnées). Demande utilisateur du
 * 2026-09-02 : dans ce cas, le champ de saisie doit proposer `/salvage`, qui trie ces travaux par
 * leur CONTENU avant toute publication. C'est un garde-fou déterministe, pas une consigne de prose :
 * la règle ne dépend pas de ce que le modèle a pensé à écrire.
 */
const ACTES_DE_PUBLICATION =
  /\b(commit\w*|push\w*|pousse[rz]?|pull request|\bPR\b|merge\w*|fusionn\w*|publi\w*|livre[rz]?|livraison|d[ée]ploi\w*|d[ée]ploy\w*|release|mets? en ligne|mise en ligne)\b/i

export const PROMPT_SALVAGE =
  "Lance /salvage : trie par leur contenu tous les travaux non publiés (copies de travail isolées, remises de côté, branches jamais fusionnées) avant qu'on publie quoi que ce soit."

/*
 * DEUX EXCEPTIONS, mesurees le 2026-09-03 (conv-210).
 *
 * Le garde-fou ci-dessus est volontairement aveugle : il ne lit pas ce que le tour a fait. Deux cas
 * ou cette cecite retourne l'outil contre son but :
 *
 * 1. Le prompt EST deja l'ordre de tri (`/salvage`). Le reecrire en `/salvage` n'ajoute rien mais
 *    ecrase la cible precise que le tour venait de nommer.
 * 2. La publication n'est que la SUITE d'un autre acte (« restaure X, PUIS publie »). L'acte
 *    principal est le premier ; le remplacer par un tri fait perdre la seule chose que le tour
 *    avait identifiee. Vecu : « Restaure skills/arena/SKILL.md, puis publie » est devenu un
 *    `/salvage` alors que le tri venait d'etre termine dans ce meme tour.
 *
 * Le garde-fou garde tout son mordant sur le cas qu'il vise : un prompt dont l'acte PRINCIPAL est
 * de publier.
 */
const ORDRE_DE_TRI = /\/salvage\b/i
const CHARNIERE_DE_SUITE = /\b(puis|ensuite|apr[eè]s (?:quoi|avoir)|et enfin)\b/i

/*
 * TROISIEME EXCEPTION : LE TRI VIENT D'AVOIR LIEU.
 *
 * VECU LE 2026-09-04 (conv-288), trois tours d'affilee. L'utilisateur envoie `/salvage`, le tri est
 * fait de bout en bout — toutes les cachettes sondees, chaque travail juge par son contenu, les
 * verdicts enregistres —, et la seule suite qui reste est de publier. Ce prompt de publication est
 * alors reecrit en `/salvage`. L'utilisateur renvoie ce que le champ lui propose, le tri est refait,
 * ne trouve rien, et propose de publier. La boucle est PARFAITE et ne se termine jamais.
 *
 * Le garde-fou etait aveugle a ce que le tour venait de faire : il relisait le prompt sortant sans
 * jamais regarder la demande ENTRANTE. Or quand cette demande EST l'ordre de tri, le tri a eu lieu
 * dans ce tour meme — exiger qu'il soit refait avant de publier, c'est exiger l'impossible.
 *
 * C'est la cause finale du « je passe ma vie a /salvage » : l'application ne se contentait pas de le
 * rappeler, elle REECRIVAIT la suite proposee en un ordre deja execute.
 */
export function ordreDeTriDejaJoue(demandeDuTour: string | undefined): boolean {
  return demandeDuTour !== undefined && ORDRE_DE_TRI.test(demandeDuTour)
}

export function estPromptDePublication(prompt: string, demandeDuTour?: string): boolean {
  if (ordreDeTriDejaJoue(demandeDuTour)) return false
  if (ORDRE_DE_TRI.test(prompt)) return false
  const charniere = prompt.search(CHARNIERE_DE_SUITE)
  if (charniere > 0 && !ACTES_DE_PUBLICATION.test(prompt.slice(0, charniere))) return false
  return ACTES_DE_PUBLICATION.test(prompt)
}
