/**
 * COLLER LE TEXTE PARLÉ D'UN TOUR — sans souder deux messages en un seul.
 *
 * DEFAUT VECU (conv-152, 2026-09-02) : dans un tour à plusieurs itérations, chaque itération
 * produit son propre message. `streamedSpoken += texte` collait le message de l'itération 2
 * DIRECTEMENT à la fin de celui de l'itération 1, sans le moindre séparateur. Le fil affichait donc
 * « …dernier maillon du balayage.```html-render » — et comme une clôture de bloc Markdown ne compte
 * QUE si elle commence une ligne, le bloc `html-render` n'était plus reconnu : la page mise en
 * forme sortait en texte brut. Le même défaut collait aussi les phrases entre elles
 * (« …fusionnées.15 copies isolées »), rendant la lecture pénible sur TOUS les tours multi-étapes.
 *
 * Coller les fragments d'UN MÊME message reste correct : c'est le streaming, ils forment une phrase.
 * La séparation ne s'insère qu'à la FRONTIÈRE d'itération, et jamais si le texte déjà accumulé
 * termine par une ligne vide — on ne veut pas empiler les blancs.
 */
export function collerTexteParle(
  accumule: string,
  texte: string,
  memeIteration: boolean
): string {
  if (!accumule) return texte
  if (memeIteration) return accumule + texte
  // Deux sauts de ligne : en Markdown, c'est ce qui sépare deux blocs. Un seul laisserait la
  // clôture de bloc collée au paragraphe précédent dans certains rendus.
  const dejaSepare = /\n[ \t]*\n[ \t]*$/u.test(accumule)
  return dejaSepare ? accumule + texte : `${accumule.replace(/[ \t]+$/u, '')}\n\n${texte}`
}
