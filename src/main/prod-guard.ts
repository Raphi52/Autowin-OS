/**
 * CLASSIFIEUR DE PRODUCTION — décide, et RIEN d'autre.
 *
 * POURQUOI. Mesuré le 2026-09-16 dans ce dépôt : aucun garde ne retient un geste sur la production.
 * `sql-read-guard.ts` protège la LECTURE des bases RIG, et `autorisation-commande.ts` dit lui-même
 * en en-tête que `decisionDeCommande('rm -rf /', [])` rend `autorise: true` — ce n'est pas un garde
 * de sécurité. Ce qui retient aujourd'hui un geste irréversible est de la PROSE de constitution,
 * donc le bon vouloir du modèle. Ce module est la première pièce qui remplace cette prose par du
 * code déterministe.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS. Il classe une CIBLE en `prod`, `non-prod` ou `inconnu`.
 * Il n'exécute rien, ne bloque rien, n'émet aucun jeton d'autorisation et n'est encore branché nulle
 * part : c'est volontaire. Une fonction PURE se teste exhaustivement ; un garde mêlé à l'exécution,
 * non.
 *
 * INCONNU VAUT PROD (`estBloquant`). L'absence d'information n'est pas une permission. C'est le même
 * choix que `sql-read-guard.ts` : refus par défaut. Conséquence assumée — une cible non déclarée
 * demandera une autorisation ; c'est le prix pour qu'un oubli de déclaration ne crée pas un trou.
 *
 * PAS DE MOTIF DE NOM, JAMAIS. `sql-read-catalog.ts` a déjà payé cette leçon : `RIG_LE_PUY_MARTIN`
 * ressemble à un greffe et n'en est pas un. Un nom qui contient « prod » ne prouve rien, et un nom
 * qui n'en contient pas ne prouve rien non plus (`RIG_AMIENS` est une base de production).
 * L'autorité est donc une LISTE DÉCLARÉE, passée en paramètre — jamais une expression régulière
 * devinée ici.
 *
 * L'APPARIEMENT EST EXACT, après normalisation. Un préfixe ou une inclusion de texte rouvriraient la
 * porte au faux positif du nom : `RIG_AMIENS_TEST` n'est pas `RIG_AMIENS`, et doit tomber en
 * `inconnu` (donc bloquant) plutôt que d'hériter du classement d'un voisin. Seule exception : les
 * chemins de fichiers, comparés par SEGMENTS, parce qu'un dossier déclaré couvre réellement ce
 * qu'il contient.
 */

/** Ce qu'une cible peut être. `inconnu` est un verdict à part entière, pas une absence de verdict. */
export type ClasseCible = 'prod' | 'non-prod' | 'inconnu'

/**
 * Les natures de cible reconnues. Elles sont distinctes parce que leur comparaison diffère :
 * un chemin se compare par segments, tout le reste à l'identique.
 */
export type NatureCible = 'base' | 'serveur' | 'chemin' | 'branche' | 'service'

export interface Cible {
  nature: NatureCible
  /** Le nom brut, tel qu'il arrive de l'appelant. La normalisation est faite ici. */
  nom: string
}

/** Une entrée de la liste d'autorité : une cible déclarée et sa classe. */
export interface EntreeAutorite {
  nature: NatureCible
  nom: string
  classe: 'prod' | 'non-prod'
  /**
   * D'où vient ce classement, en clair. Sert à répondre « pourquoi c'est bloqué » sans relire le
   * fichier de déclaration.
   */
  motif?: string
}

/** La liste d'autorité, une fois validée. Seules les fonctions de ce module la lisent. */
export interface AutoriteProd {
  readonly entrees: readonly EntreeAutorite[]
}

export interface Verdict {
  classe: ClasseCible
  /** `true` dès que la classe n'est pas `non-prod` — la seule valeur qui autorise à passer. */
  estBloquant: boolean
  /** Phrase courte, destinée à être renvoyée telle quelle à l'appelant puis à l'utilisateur. */
  raison: string
}

/**
 * NORMALISATION. Les cibles arrivent de sources hétérogènes (un message, une config, un chemin
 * Windows). On aligne donc la casse et les séparateurs avant toute comparaison, sinon
 * `D:\AutoWinOS` et `d:/autowinos` désigneraient deux choses différentes.
 *
 * On ne fait RIEN de plus : pas de résolution de chemin relatif, pas d'expansion de variable. Un
 * traitement « malin » ici produirait des égalités que l'auteur de la liste n'a pas voulues.
 */
function normaliser(nature: NatureCible, nom: string): string {
  const base = nom.trim().toLowerCase()
  if (nature !== 'chemin') return base
  return base.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Découpe un chemin normalisé en segments non vides — la base de la couverture par dossier. */
function segments(chemin: string): string[] {
  return chemin.split('/').filter((segment) => segment.length > 0)
}

/**
 * Un chemin déclaré COUVRE un chemin candidat s'il en est le dossier parent, ou le chemin lui-même.
 * Comparaison par SEGMENTS et non par préfixe de texte : sans cela, `/srv/app` couvrirait
 * `/srv/application`, qui est un autre service.
 */
function cheminCouvert(declare: string, candidat: string): boolean {
  const segmentsDeclare = segments(declare)
  const segmentsCandidat = segments(candidat)
  if (segmentsDeclare.length === 0) return false
  if (segmentsDeclare.length > segmentsCandidat.length) return false
  return segmentsDeclare.every((segment, index) => segment === segmentsCandidat[index])
}

/**
 * CONSTRUIT LA LISTE D'AUTORITÉ À PARTIR DE DÉCLARATIONS BRUTES.
 *
 * Les entrées inutilisables sont ÉCARTÉES plutôt que de faire échouer la construction : une
 * déclaration abîmée ne doit pas priver l'application de tout le reste de sa liste. Une entrée
 * écartée ne devient pas permissive pour autant — la cible correspondante retombe en `inconnu`,
 * donc bloquante.
 *
 * Un CONFLIT (la même cible déclarée `prod` et `non-prod`) est tranché vers `prod`. La déclaration
 * la plus prudente gagne, toujours.
 */
export function construireAutoriteProd(declarations: readonly EntreeAutorite[]): AutoriteProd {
  const parCle = new Map<string, EntreeAutorite>()
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.nom !== 'string') continue
    const nom = normaliser(declaration.nature, declaration.nom)
    if (nom.length === 0) continue
    if (declaration.classe !== 'prod' && declaration.classe !== 'non-prod') continue
    const cle = `${declaration.nature}\u0000${nom}`
    const existante = parCle.get(cle)
    if (existante && existante.classe === 'prod') continue
    parCle.set(cle, { ...declaration, nom })
  }
  return { entrees: [...parCle.values()] }
}

/**
 * CLASSE UNE CIBLE. Fonction pure : mêmes entrées, même verdict, aucun effet de bord.
 *
 * Ordre de décision, et il compte : si deux entrées s'appliquent — typiquement un dossier de
 * production qui contient un sous-dossier déclaré de test —, c'est la plus SPÉCIFIQUE qui gagne,
 * sinon déclarer une exception serait impossible. À spécificité égale, `prod` l'emporte.
 */
export function classerCible(cible: Cible, autorite: AutoriteProd): Verdict {
  if (!cible || typeof cible.nom !== 'string' || cible.nom.trim().length === 0) {
    return {
      classe: 'inconnu',
      estBloquant: true,
      raison: 'Cible vide ou illisible : traitée comme production.'
    }
  }
  const nom = normaliser(cible.nature, cible.nom)
  let meilleure: { entree: EntreeAutorite; specificite: number } | undefined
  for (const entree of autorite.entrees) {
    if (entree.nature !== cible.nature) continue
    let specificite: number | undefined
    if (cible.nature === 'chemin') {
      if (cheminCouvert(entree.nom, nom)) specificite = segments(entree.nom).length
    } else if (entree.nom === nom) {
      specificite = 1
    }
    if (specificite === undefined) continue
    if (!meilleure) {
      meilleure = { entree, specificite }
      continue
    }
    if (specificite > meilleure.specificite) {
      meilleure = { entree, specificite }
      continue
    }
    if (specificite === meilleure.specificite && entree.classe === 'prod') {
      meilleure = { entree, specificite }
    }
  }
  if (!meilleure) {
    return {
      classe: 'inconnu',
      estBloquant: true,
      raison: `Cible non déclarée (${cible.nature} « ${cible.nom} ») : traitée comme production.`
    }
  }
  const { entree } = meilleure
  if (entree.classe === 'prod') {
    return {
      classe: 'prod',
      estBloquant: true,
      raison: entree.motif
        ? `Production déclarée : ${entree.motif}`
        : `Production déclarée (${cible.nature} « ${entree.nom} »).`
    }
  }
  return {
    classe: 'non-prod',
    estBloquant: false,
    raison: entree.motif
      ? `Hors production : ${entree.motif}`
      : `Hors production déclaré (${cible.nature} « ${entree.nom} »).`
  }
}
