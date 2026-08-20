import type { SuggestionGroup } from './scout-suggestions'

/**
 * Rend cliquables les reponses d'une question posee par le modele.
 *
 * Pourquoi une commande DECLAREE plutot qu'une lecture du texte : mesure du 2026-08-10 sur les
 * 883 conversations de l'instance canary — le modele ne liste pas ses options, il termine en prose
 * (« Veux-tu que je le fasse ? »). Une heuristique sur les puces de fin de message proposait comme
 * reponses cliquables des resultats de tests (`589/589 tests verts`), des lignes d'erreur et des
 * chemins de fichiers — sur 3 echantillons sur 4. Cliquer dessus aurait renvoye ces textes comme
 * prompt. Un choix se declare, il ne se devine pas.
 *
 * CONTRAT ELARGI (20/08). L'ancien contrat etait `options: string[]` : un tableau de chaines, donc
 * le libellE portait TOUT le raisonnement (chemins, parentheses, mises en garde) et le front ne
 * pouvait pas etre honnete — pas de recommandation marquee, pas de consequence, pas de cout. Une
 * option porte desormais un libelle COURT, sa consequence en une ligne, et facultativement le
 * detail de la decision. Les chaines nues restent acceptees : un modele qui emet l'ancienne forme
 * obtient un bloc degrade mais valide, jamais une erreur.
 *
 * Ce qui repart au clic : `envoi` s'il est fourni, sinon le libelle. Le prompt emprunte le chemin
 * ordinaire et ses autorisations — rien de neuf de ce cote.
 */

/** Le detail deplie : le triplet d'une DECISION, pas d'une tache. */
export interface AskOptionDetail {
  /** Ce que ca fait. */
  fait?: string
  /** Ce que ca touche (fichiers, perimetre). */
  touche?: string
  /** Ce que ca ne regle PAS — le residu assume, jamais tu. */
  neReglePas?: string
}

export interface AskOption {
  libelle: string
  consequence?: string
  recommande?: boolean
  detail?: AskOptionDetail
  /** Ce qui repart comme prompt au clic. Defaut : le libelle. */
  envoi?: string
}

/** Ce qu'une action `ask` reussie porte dans son `data`. */
export interface AskChoicesData {
  question: string
  options: (string | AskOption)[]
}

/** La decision prete a rendre : question + lignes, toujours EMPILEES (jamais cote a cote). */
export interface AskDecision {
  question: string
  options: AskOption[]
}

const PLAFOND_LIBELLE = 200
const PLAFOND_LIGNE = 400

function texte(valeur: unknown, plafond: number): string | undefined {
  if (typeof valeur !== 'string') return undefined
  const propre = valeur.trim()
  if (!propre) return undefined
  return propre.slice(0, plafond)
}

function detail(valeur: unknown): AskOptionDetail | undefined {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return undefined
  const brut = valeur as Record<string, unknown>
  const fait = texte(brut.fait, PLAFOND_LIGNE)
  const touche = texte(brut.touche, PLAFOND_LIGNE)
  const neReglePas = texte(brut.neReglePas, PLAFOND_LIGNE)
  if (!fait && !touche && !neReglePas) return undefined
  return { ...(fait && { fait }), ...(touche && { touche }), ...(neReglePas && { neReglePas }) }
}

function optionNormalisee(valeur: unknown): AskOption | null {
  if (typeof valeur === 'string') {
    const libelle = texte(valeur, PLAFOND_LIBELLE)
    return libelle ? { libelle } : null
  }
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null
  const brut = valeur as Record<string, unknown>
  const libelle = texte(brut.libelle, PLAFOND_LIBELLE)
  if (!libelle) return null
  const consequence = texte(brut.consequence, PLAFOND_LIGNE)
  const envoi = texte(brut.envoi, PLAFOND_LIGNE)
  const detaille = detail(brut.detail)
  return {
    libelle,
    ...(consequence && { consequence }),
    ...(brut.recommande === true && { recommande: true as const }),
    ...(detaille && { detail: detaille }),
    ...(envoi && { envoi })
  }
}

/**
 * La decision a rendre, ou `null` si la charge utile n'en est pas une.
 *
 * Une seule reponse n'est pas un choix : mieux vaut laisser la question en texte que d'afficher un
 * bouton unique, qui ressemblerait a une validation. Cette garde est anterieure au nouveau contrat
 * et le traverse intacte.
 */
export function parseAskDecision(part: {
  kind: string
  name?: string
  ok?: boolean
  data?: unknown
}): AskDecision | null {
  if (part.kind !== 'action' || part.name !== 'ask' || part.ok !== true) return null
  const data = part.data as Partial<AskChoicesData> | undefined
  if (!data || typeof data.question !== 'string' || !data.question.trim()) return null
  if (!Array.isArray(data.options)) return null

  const options = data.options
    .map(optionNormalisee)
    .filter((option): option is AskOption => option !== null)
  if (options.length < 2) return null

  // Une seule ligne peut porter la marque : deux « recommande » ne recommandent rien. La premiere
  // gagne, les suivantes perdent la marque plutot que de faire disparaitre l'option.
  let dejaRecommandee = false
  const dedoublonnees = options.map((option) => {
    if (!option.recommande) return option
    if (dejaRecommandee) {
      // On retire la marque sans jeter l'option : ce qui tombe, c'est la recommandation en double.
      const sansMarque: AskOption = { libelle: option.libelle }
      if (option.consequence) sansMarque.consequence = option.consequence
      if (option.detail) sansMarque.detail = option.detail
      if (option.envoi) sansMarque.envoi = option.envoi
      return sansMarque
    }
    dejaRecommandee = true
    return option
  })

  return { question: data.question.trim().slice(0, PLAFOND_LIGNE), options: dedoublonnees }
}

/** Ce qui repart comme prompt quand la ligne est choisie. */
export function promptDeLOption(option: AskOption): string {
  return option.envoi ?? option.libelle
}

/**
 * Ancien rendu (grille de chips) — conserve pour les appelants qui n'ont pas encore migre.
 * @deprecated Le bloc de decision est `parseAskDecision` + `AskDecisionBlock`.
 */
export function parseAskChoices(part: {
  kind: string
  name?: string
  ok?: boolean
  data?: unknown
}): SuggestionGroup[] | null {
  const decision = parseAskDecision(part)
  if (!decision) return null
  return [
    {
      key: 'ask',
      title: decision.question,
      items: decision.options.map((option) => ({ label: option.libelle }))
    }
  ]
}
