/**
 * LES RÉDUCTIONS DE LA PLANCHE DES PERSONNAGES, préparées une fois (conv-1526, « les personnages sont
 * laggy dans l'accueil »).
 *
 * DÉFAUT MESURÉ (2026-11-04, sur l'app en Bureau à distance, Accueil affiché) : 3,4 images/s. Sauter les
 * ~20 dessins de personnages par image : 32 images/s (la limite de l'écran). Les mêmes dessins en lissage
 * « low » : 32 ; en « medium » : 4,0 ; en « high » (réglage de la scène) : 3,6. Un ImageBitmap à la
 * place de la toile : 4,2. Le coût ne vient donc ni de la taille de l'image ni de son transfert, mais
 * des réductions (mipmaps) que « medium » et « high » font refaire à la carte graphique pour TOUTE la
 * planche (1512 × 3910), à chaque dessin, quand on la rétrécit : une toile ne garde pas ses réductions.
 *
 * Ici : la moitié, le quart et le huitième de la planche, case par case, faits une fois au chargement.
 * Le personnage est lu dans la plus petite qui reste au moins aussi grande que lui à l'écran, en lissage
 * « low » : un rapport entre 0,5 et 1, que le bilinéaire rend sans crénelage, sans réduction à refaire.
 */

/** Une version de la planche : ses deux toiles (corps, ombre) et la taille d'une case. */
export interface NiveauPlanche {
  A: HTMLCanvasElement
  AO: HTMLCanvasElement
  cw: number
  ch: number
}

/** Les réductions préparées, en part de la taille d'origine. */
const REDUCTIONS = [0.5, 0.25, 0.125] as const

/** Les colonnes de toute planche de personnages (`COLS` des scripts d'atlas, conv-1428). */
export const COLONNES_PLANCHE = 12

/**
 * La finesse d'une planche par rapport à la grille de `donnees.json` (cases de `cw` px) : 1 pour les
 * atlas d'origine, 2 pour le tanuki v3 rendu en ×2 (conv-1558), net quand le zoom approche d'une tour.
 * Lue sur sa largeur, puisqu'elle a toujours 12 colonnes. Une largeur qui n'en est pas un multiple
 * entier découperait des cases à cheval : on le dit plutôt que de dessiner des morceaux.
 */
export function finesseDePlanche(largeur: number, cw: number): number {
  const f = largeur / (COLONNES_PLANCHE * cw)
  if (!Number.isInteger(f) || f < 1)
    throw new Error(
      `planche de ${largeur} px de large : attendu un multiple entier de ${COLONNES_PLANCHE * cw}`
    )
  return f
}

/**
 * L'indice du niveau à lire pour une échelle `e` (pixels d'écran par pixel de la grille de
 * `donnees.json`) : le plus petit niveau dont la part reste ≥ `e`. `parts[0]` est la finesse de la
 * planche (1, ou 2 pour une planche ×2). Sous la plus petite part, on garde la plus petite.
 */
export function niveauPourEchelle(e: number, parts: readonly number[]): number {
  let i = 0
  while (i + 1 < parts.length && parts[i + 1] >= e) i++
  return i
}

/** L'échelle la plus réduite d'une transformation 2D : la carte graphique choisit sa réduction d'après elle. */
export function echelleMin(m: { a: number; b: number; c: number; d: number }): number {
  return Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))
}

/** Une toile `cw × ch` cases, réduite case par case de `source` (cases `scw × sch`). */
function reduire(
  source: HTMLCanvasElement,
  scw: number,
  sch: number,
  colonnes: number,
  rangees: number,
  cw: number,
  ch: number
): HTMLCanvasElement {
  const t = document.createElement('canvas')
  t.width = colonnes * cw
  t.height = rangees * ch
  const g = t.getContext('2d') as CanvasRenderingContext2D
  // Réduire de moitié en bilinéaire, case alignée, fait la moyenne de 2 × 2 pixels : le bon filtre, sans
  // réduction à générer (en « high », chacun des 276 dessins referait celles de toute la planche).
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'low'
  for (let r = 0; r < rangees; r++)
    for (let c = 0; c < colonnes; c++)
      g.drawImage(source, c * scw, r * sch, scw, sch, c * cw, r * ch, cw, ch)
  return t
}

/**
 * Les niveaux de la planche, de l'original (indice 0) au huitième. Chaque niveau est réduit du précédent,
 * case par case : une case ne déborde pas sur sa voisine, et chaque pas ne divise que par deux.
 */
export function niveauxDePlanche(
  A: HTMLCanvasElement,
  AO: HTMLCanvasElement,
  cw: number,
  ch: number
): NiveauPlanche[] {
  const colonnes = Math.round(A.width / cw)
  const rangees = Math.round(A.height / ch)
  const niveaux: NiveauPlanche[] = [{ A, AO, cw, ch }]
  for (const part of REDUCTIONS) {
    const p = niveaux[niveaux.length - 1]
    const lw = Math.ceil(cw * part)
    const lh = Math.ceil(ch * part)
    niveaux.push({
      A: reduire(p.A, p.cw, p.ch, colonnes, rangees, lw, lh),
      AO: reduire(p.AO, p.cw, p.ch, colonnes, rangees, lw, lh),
      cw: lw,
      ch: lh
    })
  }
  return niveaux
}
