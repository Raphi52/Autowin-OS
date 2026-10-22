/**
 * BLOCS DE DONNEES — le modele envoie des DONNEES, l'app fait la mise en page (conv-1074,
 * 2026-10-22).
 *
 * Avant, un tableau, une comparaison ou un plan en etapes « joli » passait par une page
 * `html-render` : le modele ecrivait tout le HTML et le CSS, couleurs comprises, et ce code lui etait
 * renvoye a chaque tour. Ici, il ecrit un JSON court dans une fence ```aw-tableau, ```aw-comparaison
 * ou ```aw-etapes ; l'app le dessine avec ses propres composants (`BlocDonnees.tsx`), dans le theme
 * choisi. C'est le principe des MCP Apps (blog MCP, 26/01/2026) : le serveur fournit la donnee,
 * l'hote fournit l'interface. `html-render` reste la pour la mise en page libre.
 *
 * Lecture STRICTE : une source illisible n'est jamais devinee. Elle est refusee avec sa raison, et le
 * fil la montre comme du code — le meme repli qu'un diagramme mermaid invalide. Une ligne de tableau
 * plus longue que ses colonnes est refusee (l'accepter afficherait une cellule sans en-tete ou la
 * couperait en silence) ; une ligne plus courte est completee, comme un tableau Markdown.
 */

export const FORMES_DONNEES = ['aw-tableau', 'aw-comparaison', 'aw-etapes'] as const
export type FormeDonnees = (typeof FORMES_DONNEES)[number]

/** La langue d'une fence designe-t-elle un bloc de donnees ? */
export function estFormeDonnees(langue: string | null | undefined): langue is FormeDonnees {
  return FORMES_DONNEES.some((forme) => forme === langue)
}

export const TONS_DONNEES = ['ok', 'ko', 'attention', 'chiffre', 'discret'] as const
export type TonDonnee = (typeof TONS_DONNEES)[number]

export const STATUTS_ETAPE = ['fait', 'en-cours', 'a-faire', 'echec'] as const
export type StatutEtape = (typeof STATUTS_ETAPE)[number]

export interface CelluleDonnee {
  texte: string
  ton?: TonDonnee
}

export type BlocDonnees =
  | {
      forme: 'aw-tableau'
      titre?: string
      colonnes: string[]
      lignes: CelluleDonnee[][]
      note?: string
    }
  | {
      forme: 'aw-comparaison'
      titre?: string
      options: { nom: string; points: string[]; verdict?: CelluleDonnee; recommande?: boolean }[]
    }
  | {
      forme: 'aw-etapes'
      titre?: string
      etapes: { titre: string; detail?: string; statut?: StatutEtape }[]
    }

/** Bornes : au-dela, ce n'est plus un bloc a lire d'un coup d'oeil — la source reste visible. */
export const SOURCE_DONNEES_MAX = 200_000
export const LIGNES_TABLEAU_MAX = 300
export const COLONNES_TABLEAU_MAX = 12
export const OPTIONS_COMPARAISON_MAX = 6
export const ETAPES_MAX = 40
const TEXTE_MAX = 2_000

class Illisible extends Error {}

// fix-ok: conv-1074 nettoyage — les retouches de ce fichier retirent des forcages de type, pas un bug.
// Mesure tsc --strict : sans surcharge, `texte(v)` rend (string | undefined)[] (TS2322, code 2) ;
// sans le predicat `langue is FormeDonnees`, `span.language` (string | null) est refuse par
// lireBlocDonnees (TS2345, code 2). Avec les deux : code 0, sans `!` ni `as` dans l'appelant.
// Obligatoire, le texte est toujours rendu (sinon exception) : la surcharge le dit au typage, sans `!`.
function texte(valeur: unknown, ou: string): string
function texte(valeur: unknown, ou: string, obligatoire: false): string | undefined
function texte(valeur: unknown, ou: string, obligatoire = true): string | undefined {
  if (valeur === undefined || valeur === null) {
    if (obligatoire) throw new Illisible(`${ou} : texte attendu`)
    return undefined
  }
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
  if (typeof valeur !== 'string') throw new Illisible(`${ou} : texte attendu`)
  if (valeur.length > TEXTE_MAX) throw new Illisible(`${ou} : plus de ${TEXTE_MAX} caractères`)
  return valeur
}

function cellule(valeur: unknown, ou: string): CelluleDonnee {
  if (valeur === null || valeur === undefined) return { texte: '' }
  if (typeof valeur !== 'object') return { texte: texte(valeur, ou) }
  if (Array.isArray(valeur)) throw new Illisible(`${ou} : une cellule n'est pas une liste`)
  const objet = valeur as Record<string, unknown>
  const sortie: CelluleDonnee = { texte: texte(objet.texte, `${ou}.texte`, false) ?? '' }
  if (objet.ton !== undefined) {
    if (!TONS_DONNEES.includes(objet.ton as TonDonnee))
      throw new Illisible(
        `${ou} : ton « ${String(objet.ton)} » inconnu (${TONS_DONNEES.join(', ')})`
      )
    sortie.ton = objet.ton as TonDonnee
  }
  return sortie
}

function liste(valeur: unknown, ou: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(valeur)) throw new Illisible(`${ou} : liste attendue`)
  if (valeur.length > max)
    throw new Illisible(`${ou} : ${valeur.length} éléments, au-delà de ${max}`)
  if (valeur.length < min) throw new Illisible(`${ou} : au moins ${min} éléments`)
  return valeur
}

function objet(valeur: unknown, ou: string): Record<string, unknown> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur))
    throw new Illisible(`${ou} : objet attendu`)
  return valeur as Record<string, unknown>
}

function avecTitre<T extends object>(
  racine: Record<string, unknown>,
  bloc: T
): T & { titre?: string } {
  const titre = texte(racine.titre, 'titre', false)
  return titre ? { ...bloc, titre } : bloc
}

function tableau(racine: Record<string, unknown>): BlocDonnees {
  const colonnes = liste(racine.colonnes, 'colonnes', COLONNES_TABLEAU_MAX, 1).map((valeur, rang) =>
    texte(valeur, `colonne ${rang + 1}`)
  )
  const lignes = liste(racine.lignes, 'lignes', LIGNES_TABLEAU_MAX).map((ligne, rang) => {
    const cellules = liste(ligne, `ligne ${rang + 1}`, Number.POSITIVE_INFINITY)
    if (cellules.length > colonnes.length)
      throw new Illisible(
        `ligne ${rang + 1} : ${cellules.length} cellules pour ${colonnes.length} colonnes`
      )
    const lues = cellules.map((valeur, col) =>
      cellule(valeur, `ligne ${rang + 1}, cellule ${col + 1}`)
    )
    while (lues.length < colonnes.length) lues.push({ texte: '' })
    return lues
  })
  const note = texte(racine.note, 'note', false)
  const titre = texte(racine.titre, 'titre', false)
  return {
    forme: 'aw-tableau',
    ...(titre ? { titre } : {}),
    colonnes,
    lignes,
    ...(note ? { note } : {})
  }
}

function comparaison(racine: Record<string, unknown>): BlocDonnees {
  const options = liste(racine.options, 'options', OPTIONS_COMPARAISON_MAX, 2).map((brut, rang) => {
    const ou = `option ${rang + 1}`
    const option = objet(brut, ou)
    const points = liste(option.points ?? [], `${ou}.points`, 20).map((valeur, n) =>
      texte(valeur, `${ou}, point ${n + 1}`)
    )
    return {
      nom: texte(option.nom, `${ou}.nom`),
      points,
      ...(option.verdict !== undefined
        ? { verdict: cellule(option.verdict, `${ou}.verdict`) }
        : {}),
      ...(option.recommande === true ? { recommande: true } : {})
    }
  })
  return avecTitre(racine, { forme: 'aw-comparaison' as const, options })
}

function etapes(racine: Record<string, unknown>): BlocDonnees {
  const lues = liste(racine.etapes, 'etapes', ETAPES_MAX, 1).map((brut, rang) => {
    const ou = `étape ${rang + 1}`
    const etape = objet(brut, ou)
    if (etape.statut !== undefined && !STATUTS_ETAPE.includes(etape.statut as StatutEtape))
      throw new Illisible(
        `${ou} : statut « ${String(etape.statut)} » inconnu (${STATUTS_ETAPE.join(', ')})`
      )
    const detail = texte(etape.detail, `${ou}.detail`, false)
    return {
      titre: texte(etape.titre, `${ou}.titre`),
      ...(detail ? { detail } : {}),
      ...(etape.statut !== undefined ? { statut: etape.statut as StatutEtape } : {})
    }
  })
  return avecTitre(racine, { forme: 'aw-etapes' as const, etapes: lues })
}

/** Lit la source JSON d'une fence de donnees. Jamais d'exception : une erreur est RENDUE. */
export function lireBlocDonnees(langue: string, source: string): BlocDonnees | { erreur: string } {
  if (!estFormeDonnees(langue))
    return { erreur: `forme « ${langue} » inconnue (${FORMES_DONNEES.join(', ')})` }
  if (source.length > SOURCE_DONNEES_MAX)
    return { erreur: `source de ${source.length} caractères, au-delà de ${SOURCE_DONNEES_MAX}` }
  let brut: unknown
  try {
    brut = JSON.parse(source)
  } catch (erreur) {
    return {
      erreur: `JSON illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    }
  }
  try {
    const racine = objet(brut, 'racine')
    if (langue === 'aw-tableau') return tableau(racine)
    if (langue === 'aw-comparaison') return comparaison(racine)
    return etapes(racine)
  } catch (erreur) {
    if (erreur instanceof Illisible) return { erreur: erreur.message }
    throw erreur
  }
}

/**
 * La consigne que les prompts portent : les formes et leur JSON, en une redaction. Le lecteur
 * ci-dessus et le prompt ne peuvent plus diverger sur un nom de champ.
 */
export const CONSIGNE_BLOCS_DONNEES =
  `BLOCS DE DONNÉES (à préférer à une page html-render quand la forme s'y prête) : pour un TABLEAU, ` +
  `une COMPARAISON d'options ou des ÉTAPES, écris un bloc fermé dont le contenu est UNIQUEMENT du ` +
  `JSON — l'app le met en page elle-même, dans le thème choisi, et il ne coûte presque rien à relire. ` +
  `\`\`\`aw-tableau {"titre"?, "colonnes": ["…"], "lignes": [["…", 12, {"texte": "vert", "ton": "ok"}]], "note"?} ; ` +
  `\`\`\`aw-comparaison {"titre"?, "options": [{"nom": "…", "points": ["…"], "verdict"?: "…", "recommande"?: true}]} (2 à ${OPTIONS_COMPARAISON_MAX} options) ; ` +
  `\`\`\`aw-etapes {"titre"?, "etapes": [{"titre": "…", "detail"?: "…", "statut"?: "${STATUTS_ETAPE.join('|')}"}]}. ` +
  `Tons d'une cellule ou d'un verdict : ${TONS_DONNEES.join(', ')}. Un JSON invalide s'affiche en ` +
  `code brut : vérifie-le. Garde html-render pour une mise en page libre.`
