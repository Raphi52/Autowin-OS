// Qui passe devant qui dans le quartier. Module sans canvas : la règle se teste sur les vraies
// données (donnees.json) et la scène l'applique telle quelle, sans copie.

/** Un objet du décor : sa boîte, son type de fixation et sa ligne de pied (une valeur tous les 8 px). */
export interface ObjetPlace {
  x: number
  y: number
  w: number
  h: number
  fixe?: string
  b?: number[]
}

/** Un tanuki : son pied au sol (x, y) et sa hauteur à l'écran `u`. */
export interface TanukiPlace {
  x: number
  y: number
  u: number
}

/** Le pied de l'objet sous `px` : la ligne de pied est interpolée entre deux valeurs voisines. */
export function piedSous(o: Pick<ObjetPlace, 'x' | 'b'>, px: number): number {
  const b = o.b ?? []
  const n = b.length
  const t = Math.max(0, Math.min(n - 1, (px - o.x) / 8))
  const a = Math.floor(t)
  const e = Math.min(n - 1, a + 1)
  return b[a] + (b[e] - b[a]) * (t - a)
}

/** La boîte de l'objet touche le tanuki : son dessin déborde de ±0,4 u, de 4 px sous le pied jusqu'à u au-dessus. */
export function couvre(o: Pick<ObjetPlace, 'x' | 'y' | 'w' | 'h'>, w: TanukiPlace): boolean {
  return (
    w.x + w.u * 0.4 > o.x && w.x - w.u * 0.4 < o.x + o.w && w.y + 4 > o.y && w.y - w.u < o.y + o.h
  )
}

/** Le tanuki est derrière l'objet : son pied est plus haut à l'écran que la ligne de pied de l'objet. */
export function estDerriere(o: Pick<ObjetPlace, 'x' | 'b'>, w: TanukiPlace): boolean {
  return w.y < piedSous(o, w.x) - 1
}

/**
 * Les repeints à faire quand le tanuki `w` vient d'être posé : chaque objet qui passe devant lui, avec
 * les tanukis déjà posés qui sont devant CET objet. Le repeint entier de l'objet ne doit pas les recouvrir :
 * il les recouvrait pourtant quand un autre tanuki, posé après eux et derrière une autre partie de l'objet,
 * le déclenchait.
 */
export function repeintsApres<O extends ObjetPlace, T extends TanukiPlace>(
  w: T,
  posees: readonly T[],
  objets: readonly O[]
): { o: O; sauf: T[] }[] {
  return objets
    .filter((o) => o.fixe !== 'ciel' && !!o.b && couvre(o, w) && estDerriere(o, w))
    .map((o) => ({ o, sauf: posees.filter((c) => !estDerriere(o, c)) }))
}
