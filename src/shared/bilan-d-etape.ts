/**
 * LE BLOC FIXE DE FIN D'ETAPE (conv-989, 2026-10-16).
 *
 * Chaque etape de travail (scout, frame, terrain, build, clean) termine sa sortie par un bilan court
 * et toujours de la meme forme — consigne `CONSIGNE_BILAN`, posee par `phaseBrief` (phase-briefs.ts) :
 *
 *   ### Bilan de l’étape
 *   - Verdict : …
 *   - Fichiers touchés : …
 *   - Preuves : …
 *   - Reste à faire : …
 *
 * Pourquoi : une sortie d'etape est de la prose de longueur libre, et ce qui la COUPE (la bulle a
 * 4 000 caracteres, l'agregat du juge a sa part par etape) ne sait pas ou se trouve l'essentiel. Ce
 * bloc, lui, se reconnait : ceux qui coupent le remontent EN ENTIER. Le chemin du detail n'est pas
 * demande au modele — le code le connait (`runs/livrable-entier.ts`).
 */

/** Un bilan plus long cesse d'etre un bilan : borne, et dit. */
export const BILAN_MAX = 1_200

/** Le titre, tolerant a l'apostrophe droite et a un niveau de titre voisin (## a ####). */
const TITRE = /^#{2,4}\s*Bilan de l[’']étape\s*$/u
/** Les lignes techniques qui doivent rester les DERNIERES de la sortie (`SUITE:`, `AUTOWIN_…`). */
const LIGNE_TECHNIQUE = /^\s*(?:SUITE\s*:|AUTOWIN_[A-Z_]+V\d+\s*:)/u

export interface BilanTrouve {
  /** Le bloc, titre compris, borne a `BILAN_MAX`. */
  bilan: string
  /** Le texte SANS ce bloc ; les lignes techniques finales y restent, a leur place. */
  sansBilan: string
  /** Ce qui PRECEDE le bloc : le corps de la sortie, celui qu'on peut couper. */
  avant: string
  /** Les lignes techniques qui le SUIVENT (`SUITE:`, `AUTOWIN_…`) : elles restent les dernieres. */
  apres: string
}

/** Le DERNIER bilan du texte — celui de la version finale de l'etape — ou `undefined`. */
export function extraireBilan(texte: string): BilanTrouve | undefined {
  const lignes = texte.split(/\r?\n/u)
  let debut = -1
  for (let rang = lignes.length - 1; rang >= 0; rang -= 1) {
    if (TITRE.test(lignes[rang] ?? '')) {
      debut = rang
      break
    }
  }
  if (debut < 0) return undefined
  let fin = lignes.length
  for (let rang = debut + 1; rang < lignes.length; rang += 1) {
    if (LIGNE_TECHNIQUE.test(lignes[rang] ?? '')) {
      fin = rang
      break
    }
  }
  const brut = lignes.slice(debut, fin).join('\n').trim()
  if (!brut) return undefined
  const bilan =
    brut.length > BILAN_MAX
      ? `${brut.slice(0, BILAN_MAX)}\n…[bilan coupé à ${BILAN_MAX} caractères]`
      : brut
  const avant = lignes.slice(0, debut).join('\n').trimEnd()
  const apres = lignes.slice(fin).join('\n').trim()
  const sansBilan = [avant, apres].filter(Boolean).join('\n')
  return { bilan, sansBilan, avant, apres }
}

/** En deca, garder le bilan ne laisserait du corps qu'un fragment illisible. */
const PLACE_MIN_DU_CORPS = 400

/**
 * COUPE UN TEXTE EN GARDANT SON BILAN ENTIER, a sa place : corps coupe, puis le bilan, puis les
 * lignes techniques finales. `couper` coupe le corps a la longueur donnee. Sans bilan, ou avec un
 * bilan qui ne laisserait pas de vraie place au corps, on coupe le texte entier comme avant.
 */
export function couperEnGardantLeBilan(
  texte: string,
  plafond: number,
  couper: (corps: string, longueur: number) => string
): string {
  if (texte.length <= plafond) return texte
  const trouve = extraireBilan(texte)
  const fixe = trouve ? trouve.bilan.length + trouve.apres.length + 2 : 0
  if (!trouve || fixe + PLACE_MIN_DU_CORPS > plafond) return couper(texte, plafond)
  const corps = couper(trouve.avant, plafond - fixe)
  return [corps, trouve.bilan, trouve.apres].filter(Boolean).join('\n')
}
