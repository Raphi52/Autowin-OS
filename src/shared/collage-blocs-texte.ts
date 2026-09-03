/**
 * SÉPARATION DE DEUX BLOCS DE TEXTE RECOLLÉS — règle PURE, partagée par le fournisseur qui accumule
 * la réponse et par la diffusion en direct, pour qu'ils ne divergent jamais.
 *
 * DÉFAUT VÉCU (conv-8, 2026-09-03). Une réponse de modèle arrive en plusieurs blocs de texte séparés
 * par des appels d'outils. Le fournisseur les accumulait par `text += part.text`, sans séparateur.
 * Quand un bloc finissait par une phrase (« … est bien branchée. ») et que le suivant OUVRAIT une
 * fence (« ```html-render »), la fence se retrouvait EN MILIEU DE LIGNE :
 *
 *     …est bien branchée.```html-render
 *
 * CommonMark n'y voit plus une ouverture de bloc, le fil a rendu du HTML brut, et l'utilisateur a
 * signalé « le html ne s'est pas render ». Mesuré sur le delta `0:0:ordered:4` du journal de tour :
 * 4 925 caractères déjà soudés AVANT d'atteindre la moindre garde.
 *
 * POURQUOI ICI ET PAS EN AVAL : deux gardes existaient déjà côté chat (`separationDeltaCollee`,
 * `soudureDePhrases`), mais elles ne séparent que deux deltas DISTINCTS. Un collage survenu à
 * l'intérieur d'un seul bloc leur est invisible : elles arrivent trop tard. La cause est le point
 * d'accumulation, c'est donc lui qui porte la règle.
 *
 * La règle reste ÉTROITE — un modèle a le droit de poursuivre sa phrase d'un bloc à l'autre :
 *   · rien si l'un des deux côtés est vide ;
 *   · rien si le texte accumulé finit déjà par un saut de ligne ;
 *   · rien à l'intérieur d'une fence déjà ouverte (``` y est du CONTENU, pas un délimiteur) ;
 *   · sinon on coupe UNIQUEMENT devant une ouverture de fence, ou entre deux phrases soudées
 *     (« …ciblée.Maintenant le côté écriture », 6 occurrences mesurées le 2026-09-03).
 */

const OUVRE_UNE_FENCE = /^[ \t]*(?:```|~~~)/
const FIN_DE_PHRASE = /[.!?…][»”"')\]]*$/u
const DEBUT_DE_PHRASE = /^[\p{L}«“"'(#*\->`]/u

/** Une fence est-elle ENCORE ouverte à la fin du texte accumulé ? (nombre impair de délimiteurs) */
export function fenceEncoreOuverte(texte: string): boolean {
  const delimiteurs = texte.match(/^[ \t]*(?:```|~~~)/gm)
  return delimiteurs !== null && delimiteurs.length % 2 === 1
}

/** Deux phrases soudées sans espace : « …ciblée. » + « Maintenant… ». */
export function phrasesSoudees(precedent: string, suivant: string): boolean {
  if (!precedent || !suivant) return false
  if (/\s$/u.test(precedent) || /^\s/u.test(suivant)) return false
  return FIN_DE_PHRASE.test(precedent) && DEBUT_DE_PHRASE.test(suivant)
}

/**
 * Séparateur à INSÉRER entre le texte déjà accumulé et le bloc suivant : `''` ou `'\n\n'`.
 * Ne juge JAMAIS le contenu du modèle — seulement la frontière entre deux blocs.
 */
export function separationEntreBlocsTexte(accumule: string, suivant: string): string {
  if (!accumule || !suivant) return ''
  if (/\n[ \t]*$/.test(accumule)) return ''
  if (fenceEncoreOuverte(accumule)) return ''
  if (OUVRE_UNE_FENCE.test(suivant)) return '\n\n'
  return phrasesSoudees(accumule, suivant) ? '\n\n' : ''
}
