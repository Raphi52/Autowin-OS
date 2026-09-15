/**
 * fix-ok: scripts/cdp-chat-mermaid.mjs — le seuil de hauteur y etait ecrit en dur
 * (Math.min(hauteurFenetre * 0.6, 420)) alors que ChatView.css est passe a min(45vh, 300px) :
 * la sonde laissait donc passer un diagramme de 420px, plus haut que ce que la feuille autorise.
 * Le plafond se LIT desormais dans la feuille via getComputedStyle(svg).maxHeight.
 */

/**
 * @param {{svgHauteur:number, plafondHauteur:string|null}} preuve
 * @returns {{depasse:boolean, plafond:number|null}}
 */
export function evaluerHauteurMermaid(preuve) {
  const brut = typeof preuve.plafondHauteur === 'string' ? preuve.plafondHauteur.trim() : ''
  const correspondance = /^(-?\d+(?:\.\d+)?)px$/.exec(brut)
  if (!correspondance) return { depasse: false, plafond: null }
  const plafond = Number(correspondance[1])
  return { depasse: preuve.svgHauteur > plafond + 1, plafond }
}
