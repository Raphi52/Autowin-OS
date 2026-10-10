/**
 * Balayage « croisement » des panneaux (conv-191, 2026-10-10 : /draft « une animation pour donner un
 * cote brillant a nos panels et pk pas une reponse a la souris », puis « Un balayage en fonction de la
 * position de la souris qui va d'avant en arriere selon ou on a le curseur », « 4 5 6 » et « go 6 »).
 *
 * Deux bandes de reflet grises sont peintes sur le satin des panneaux par le theme Nebuleuse de verre
 * (`theme-nebuleuse-verre.css`, `--nv-balai-bande-1` / `--nv-balai-bande-2`). La seconde passe SOUS
 * le curseur, la premiere au point OPPOSE de l'ecran : elles se croisent au centre.
 *
 * UN SEUL REFLET POUR TOUTE LA PAGE (conv-191 : « Fais aussi des deux bandes du balayage un seul reflet
 * pour toute la page, qui suit la souris partout et ne se voit que dans les panneaux »). Comme le satin,
 * les bandes sont calees sur l'ECRAN (`fixed`) : elles ne se voient qu'a travers les panneaux, et le
 * script pose la MEME position sur les cinq a chaque mouvement de souris, ou qu'elle soit.
 *
 * Ce module ne peint rien. Il pose la position visee de chaque bande dans `--nv-balai-1` et
 * `--nv-balai-2` : l'abscisse, en largeur d'ecran, ou la bande coupe la mi-hauteur de l'ecran.
 * L'inertie (1,4 s et 2,2 s) est une transition CSS sur ces deux proprietes, enregistrees en nombres
 * (`@property`) pour pouvoir s'animer. Quand la souris quitte la fenetre, elles sont retirees : elles
 * reprennent leur valeur de repos (bandes hors de l'ecran, a gauche) et y glissent.
 * Un autre theme ne lit pas ces proprietes : elles n'y changent rien.
 */

/** Les cinq panneaux. La saisie vit DANS le fil (`.chat`) : les deux reçoivent la même position. */
export const SELECTEUR_PANNEAUX = [
  '.cosmic-outline .chat > .composer',
  '.theme-serious .rail',
  '.cosmic-outline .conv-pane',
  '.cosmic-outline .runs-pane',
  '.cosmic-outline .chat'
].join(', ')

const PROPRIETES = ['--nv-balai-1', '--nv-balai-2'] as const

export interface CiblesDuBalai {
  /** Bande qui passe par le point de l'écran OPPOSÉ au curseur. */
  premiere: number
  /** Bande qui passe sous le curseur. */
  seconde: number
}

/**
 * Curseur (x, y) dans un écran de `largeur` × `hauteur` -> position visée de chaque bande.
 * Les bandes sont à 135 deg : leurs lignes suivent x + y = constante. Une bande qui passe par (x, y)
 * coupe donc la mi-hauteur de l'écran à l'abscisse x + y - hauteur / 2, rendue ici en largeurs d'écran.
 */
export function ciblesDuBalai(
  x: number,
  y: number,
  largeur: number,
  hauteur: number
): CiblesDuBalai | null {
  if (![x, y, largeur, hauteur].every(Number.isFinite) || largeur <= 0 || hauteur <= 0) return null
  const cx = Math.min(largeur, Math.max(0, x))
  const cy = Math.min(hauteur, Math.max(0, y))
  const abscisse = (px: number, py: number): number =>
    Math.round(((px + py - hauteur / 2) / largeur) * 1000) / 1000
  return { premiere: abscisse(largeur - cx, hauteur - cy), seconde: abscisse(cx, cy) }
}

/**
 * Branche le suivi de la souris sur toute la fenêtre. Rend la fonction qui le débranche.
 * `pointermove` est déjà regroupé par le navigateur à une fois par image : pas besoin d'en sauter.
 */
export function installerBalaiDesPanneaux(fenetre: Window = window): () => void {
  const doc = fenetre.document
  const touches = new Set<HTMLElement>()

  const relacher = (): void => {
    for (const panneau of touches) for (const p of PROPRIETES) panneau.style.removeProperty(p)
    touches.clear()
  }

  const surMouvement = (evenement: MouseEvent): void => {
    const cibles = ciblesDuBalai(
      evenement.clientX,
      evenement.clientY,
      fenetre.innerWidth,
      fenetre.innerHeight
    )
    if (!cibles) return
    for (const panneau of doc.querySelectorAll<HTMLElement>(SELECTEUR_PANNEAUX)) {
      panneau.style.setProperty(PROPRIETES[0], String(cibles.premiere))
      panneau.style.setProperty(PROPRIETES[1], String(cibles.seconde))
      touches.add(panneau)
    }
  }

  doc.addEventListener('pointermove', surMouvement, { passive: true })
  doc.documentElement.addEventListener('pointerleave', relacher)
  fenetre.addEventListener('blur', relacher)
  return () => {
    doc.removeEventListener('pointermove', surMouvement)
    doc.documentElement.removeEventListener('pointerleave', relacher)
    fenetre.removeEventListener('blur', relacher)
    relacher()
  }
}
