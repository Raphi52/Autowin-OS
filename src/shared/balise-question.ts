/**
 * Une balise `<question>` est-elle POSÉE par le modèle, ou seulement CITÉE ?
 *
 * Le canal des questions du modèle est fermé : une balise posée est refusée et son contenu masqué,
 * car il peut porter un secret. Mais une réponse qui EXPLIQUE ce canal écrit la balise entre
 * backticks ou dans un bloc de code, et cette citation était prise pour une question : le tour était
 * rejoué et tout le texte qui suivait disparaissait de l'écran.
 *
 * Règle : une balise est CITÉE seulement si elle tombe dans du code Markdown (passage `…`, bloc ```
 * ou ~~~) qui se REFERME après elle. Un backtick isolé, ou un bloc jamais fermé, ne prouve aucune
 * citation : la balise reste posée, donc masquée — au pire du texte disparaît, jamais un secret ne
 * s'affiche. Hors code, la balise est posée, même sans charge JSON.
 * Le filtre du flux en direct ne connaît pas encore la suite : tant que la fermeture peut arriver,
 * la lecture est « indécise » et il retient le texte au lieu de trancher.
 */
import { suivreBlocsDeCode } from './bloc-de-code'

export const OUVERTURE_QUESTION = '<question>'
const FERMETURE_QUESTION = '</question>'

export type LectureDeBalise = 'citee' | 'posee' | 'indecise'

interface CodeOuvert {
  /** Ligne d'ouverture du bloc de code ouvert à la position, sinon null. */
  bloc: string | null
  /** Longueur de la série de backticks d'un passage de code ouvert à la position, sinon 0. */
  passage: number
}

/** Le code Markdown encore ouvert à `position`, d'après le seul texte qui la précède. */
function codeOuvertAvant(texte: string, position: number): CodeOuvert {
  const lignes = texte.slice(0, position).split('\n')
  const blocs = suivreBlocsDeCode()
  let ouverture: string | null = null
  let passage = 0
  for (let rang = 0; rang < lignes.length; rang += 1) {
    const ligne = lignes[rang]
    const complete = rang < lignes.length - 1
    // La dernière ligne est coupée à la position : elle ne peut pas être un délimiteur de bloc.
    if (complete && blocs.delimiteur(ligne)) {
      ouverture = blocs.dansUnBloc ? ligne : null
      passage = 0
      continue
    }
    if (blocs.dansUnBloc) continue
    // Un passage de code ne traverse pas une ligne vide ; la ligne coupée n'est pas encore finie.
    if (complete && !ligne.trim()) {
      passage = 0
      continue
    }
    for (const serie of ligne.matchAll(/(\\?)(`+)/g)) {
      const longueur = serie[2].length
      if (passage === 0) {
        // Hors passage, `\`` est un backtick littéral : seul le reste de la série ouvre.
        const ouvrante = serie[1] ? longueur - 1 : longueur
        if (ouvrante > 0) passage = ouvrante
      } else if (longueur === passage) passage = 0
    }
  }
  return blocs.dansUnBloc ? { bloc: ouverture, passage: 0 } : { bloc: null, passage }
}

function blocRefermeApres(
  texte: string,
  position: number,
  ouverture: string,
  complet: boolean
): LectureDeBalise {
  const blocs = suivreBlocsDeCode()
  blocs.delimiteur(ouverture)
  const finDeLigne = texte.indexOf('\n', position)
  if (finDeLigne >= 0) {
    const lignes = texte.slice(finDeLigne + 1).split('\n')
    for (let rang = 0; rang < lignes.length; rang += 1) {
      // Une ligne pas encore finie peut encore cesser d'être une fermeture (« ``` » puis « ```a »).
      if (rang === lignes.length - 1 && !complet) break
      if (blocs.delimiteur(lignes[rang]) && !blocs.dansUnBloc) return 'citee'
    }
  }
  return complet ? 'posee' : 'indecise'
}

function passageRefermeApres(
  texte: string,
  depuis: number,
  longueur: number,
  complet: boolean
): LectureDeBalise {
  const suite = texte.slice(depuis)
  const ligneVide = /\n[ \t]*\n/.exec(suite)
  const paragraphe = ligneVide ? suite.slice(0, ligneVide.index) : suite
  for (const serie of paragraphe.matchAll(/`+/g)) {
    if (serie[0].length !== longueur) continue
    // Une série qui touche la fin du texte reçu peut encore s'allonger au morceau suivant.
    const touchelaFin = (serie.index ?? 0) + serie[0].length === suite.length
    return touchelaFin && !complet ? 'indecise' : 'citee'
  }
  return ligneVide || complet ? 'posee' : 'indecise'
}

/**
 * Lit la balise `<question>` qui commence à `position`. `complet` : le texte reçu est entier (sinon
 * la suite peut encore arriver, et une fermeture absente rend la lecture indécise).
 */
export function lireLaBalise(texte: string, position: number, complet: boolean): LectureDeBalise {
  const { bloc, passage } = codeOuvertAvant(texte, position)
  if (bloc !== null) return blocRefermeApres(texte, position, bloc, complet)
  if (passage > 0)
    return passageRefermeApres(texte, position + OUVERTURE_QUESTION.length, passage, complet)
  return 'posee'
}

/** Position de la prochaine balise `<question>` posée, à partir de `depuis` ; -1 sinon. */
export function prochaineQuestionPosee(texte: string, depuis = 0): number {
  const minuscule = texte.toLowerCase()
  let index = minuscule.indexOf(OUVERTURE_QUESTION, depuis)
  while (index >= 0 && lireLaBalise(texte, index, true) === 'citee') {
    index = minuscule.indexOf(OUVERTURE_QUESTION, index + OUVERTURE_QUESTION.length)
  }
  return index
}

export function contientUneQuestionPosee(texte: string): boolean {
  return prochaineQuestionPosee(texte) >= 0
}

/**
 * Remplace chaque question posée par `marqueur`, jusqu'à sa fermeture, ou jusqu'à la fin du texte si
 * elle n'est jamais fermée. Les citations restent intactes.
 */
export function masquerLesQuestionsPosees(texte: string, marqueur: string): string {
  const minuscule = texte.toLowerCase()
  let sortie = ''
  let curseur = 0
  for (
    let index = prochaineQuestionPosee(texte);
    index >= 0;
    index = prochaineQuestionPosee(texte, curseur)
  ) {
    sortie += texte.slice(curseur, index) + marqueur
    const fermeture = minuscule.indexOf(FERMETURE_QUESTION, index + OUVERTURE_QUESTION.length)
    curseur = fermeture < 0 ? texte.length : fermeture + FERMETURE_QUESTION.length
  }
  return sortie + texte.slice(curseur)
}
