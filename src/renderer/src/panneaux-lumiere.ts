/**
 * La souris est la source de lumière des panneaux (conv-191, 2026-10-10 : « le comportement je l'aime
 * pas trop draft moi des animations », « en fait j'aimerais que ca fasse comme si ma souris etait la
 * source de lumiere », puis « go Ambiance implemente »).
 *
 * Le thème Nébuleuse de verre peint une lumière lointaine et large, centrée sur la souris
 * (`theme-nebuleuse-verre.css`, `--nv-lumiere-*`). Comme le satin, elle est calée sur l'ÉCRAN : une
 * seule lumière pour toute la page, qui ne se voit qu'à travers les panneaux.
 *
 * Ce module ne peint rien. À chaque mouvement de souris, où qu'elle soit, il pose sur les
 * panneaux (`SELECTEUR_PANNEAUX`) la position du curseur en fractions de l'écran (`--nv-lumiere-x`, `--nv-lumiere-y`). Le
 * glissement (0,6 s) est une transition CSS sur ces deux propriétés, enregistrées en nombres
 * (`@property`). Quand la souris quitte la fenêtre, elles sont retirées : la lumière reprend sa
 * place de repos, hors de l'écran à gauche, et y glisse.
 * Un autre thème ne lit pas ces propriétés : elles n'y changent rien.
 */

/**
 * Les panneaux éclairés : les cinq du Chat, plus le cadre de page des autres vues (`.view-page`)
 * et les panneaux de l'Accueil, tuiles et plaque du titre (conv-211 : « faut aligner toutes les
 * autres views »). La saisie vit DANS le fil (`.chat`) : les deux reçoivent la même position.
 */
export const SELECTEUR_PANNEAUX = [
  '.cosmic-outline .chat > .composer',
  '.theme-serious .rail',
  '.cosmic-outline .conv-pane',
  '.cosmic-outline .runs-pane',
  '.cosmic-outline .chat',
  '.view-page',
  '.home-tile__panel',
  '.home-view__masthead'
].join(', ')

const PROPRIETES = ['--nv-lumiere-x', '--nv-lumiere-y'] as const

/** Curseur (x, y) dans un écran de `largeur` × `hauteur` -> sa position en fractions de l'écran. */
export function positionDeLaLumiere(
  x: number,
  y: number,
  largeur: number,
  hauteur: number
): { x: number; y: number } | null {
  if (![x, y, largeur, hauteur].every(Number.isFinite) || largeur <= 0 || hauteur <= 0) return null
  const fraction = (v: number, t: number): number =>
    Math.round(Math.min(1, Math.max(0, v / t)) * 10000) / 10000
  return { x: fraction(x, largeur), y: fraction(y, hauteur) }
}

/**
 * Branche le suivi de la souris sur toute la fenêtre. Rend la fonction qui le débranche.
 * `pointermove` est déjà regroupé par le navigateur à une fois par image : pas besoin d'en sauter.
 */
export function installerLumiereDesPanneaux(fenetre: Window = window): () => void {
  const doc = fenetre.document
  const touches = new Set<HTMLElement>()

  const eteindre = (): void => {
    for (const panneau of touches) for (const p of PROPRIETES) panneau.style.removeProperty(p)
    touches.clear()
  }

  const surMouvement = (evenement: MouseEvent): void => {
    const position = positionDeLaLumiere(
      evenement.clientX,
      evenement.clientY,
      fenetre.innerWidth,
      fenetre.innerHeight
    )
    if (!position) return
    for (const panneau of doc.querySelectorAll<HTMLElement>(SELECTEUR_PANNEAUX)) {
      panneau.style.setProperty(PROPRIETES[0], String(position.x))
      panneau.style.setProperty(PROPRIETES[1], String(position.y))
      touches.add(panneau)
    }
  }

  doc.addEventListener('pointermove', surMouvement, { passive: true })
  doc.documentElement.addEventListener('pointerleave', eteindre)
  fenetre.addEventListener('blur', eteindre)
  return () => {
    doc.removeEventListener('pointermove', surMouvement)
    doc.documentElement.removeEventListener('pointerleave', eteindre)
    fenetre.removeEventListener('blur', eteindre)
    eteindre()
  }
}
