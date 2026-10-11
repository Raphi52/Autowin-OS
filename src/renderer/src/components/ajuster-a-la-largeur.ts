/**
 * LE FIL NE DEFILE JAMAIS EN LARGEUR (2026-10-11, conv-248 : « je veux pas de scroll horizontal
 * dans le chat »).
 *
 * Mesure avant correctif, instance cachee a 900 px (colonne de 372 px) : un tableau de neuf
 * colonnes portait 1 366 px de contenu dans 327 px, et un bloc ```html-render``` 1 709 px dans
 * 329 px — chacun avec sa propre barre de defilement horizontale (`overflow-x: auto`).
 *
 * La feuille de style rend d'abord ces contenus FLUIDES (retour a la ligne, largeur bornee) : c'est
 * le cas courant, et il ne doit rien couter. Il reste ce que le contenu IMPOSE lui-meme — une grille
 * a pistes fixes, un texte `nowrap` voulu par le modele, un tableau de vingt colonnes. Pour ce
 * reste, couper ferait perdre de l'information sans le dire, et defiler est precisement ce qui est
 * refuse : le bloc est donc REDUIT A L'ECHELLE jusqu'a tenir dans la colonne, comme une image.
 *
 * `zoom` (et non `transform: scale`) parce qu'il agit sur la mise en page : la hauteur du bloc
 * suit, sans laisser de vide sous un contenu retreci.
 */
import { useLayoutEffect, type RefObject } from 'react'

/**
 * Facteur qui fait tenir `largeurContenu` dans `largeurVisible`. Rend 1 quand il n'y a rien a faire
 * (contenu deja contenu, ou mesure absente — un environnement sans mise en page rend des zeros).
 * Arrondi PAR DEFAUT au millieme : arrondir au plus proche laisserait deborder d'un pixel.
 */
export function facteurPourTenir(largeurVisible: number, largeurContenu: number): number {
  if (!(largeurVisible > 0) || !(largeurContenu > largeurVisible + 1)) return 1
  return Math.floor((largeurVisible / largeurContenu) * 1000) / 1000
}

/** Remet le bloc a l'echelle 1, mesure son debordement, puis le reduit s'il depasse. */
export function ajusterALaLargeur(bloc: HTMLElement): void {
  bloc.style.zoom = ''
  const facteur = facteurPourTenir(bloc.clientWidth, bloc.scrollWidth)
  if (facteur < 1) bloc.style.zoom = String(facteur)
}

/**
 * Garde le bloc `ref` a la largeur de sa colonne : a l'affichage, quand `contenu` change, quand la
 * colonne change de largeur (fenetre, panneau ouvert), et quand son propre contenu change de forme
 * (image chargee, `<details>` deplie, onglet radio bascule).
 *
 * Seul un changement de LARGEUR A L'ECRAN du bloc relance la mesure. Le zoom change sa hauteur
 * (l'observateur se reveille alors) mais pas sa largeur a l'ecran, qui reste celle de la colonne :
 * aucune boucle. Pourquoi pas la largeur du parent : un tableau est rendu dans un `<span>`, dont
 * `clientWidth` vaut toujours 0 — mesure 2026-10-11, un tableau reduit a 0,447 dans une colonne de
 * 327 px restait reduit a 0,447 une fois la colonne passee a 827 px.
 */
export function useAjusterALaLargeur(ref: RefObject<HTMLElement | null>, contenu: unknown): void {
  useLayoutEffect(() => {
    const bloc = ref.current
    if (!bloc) return
    const reajuster = (): void => ajusterALaLargeur(bloc)
    reajuster()
    // `load` et `toggle` ne remontent pas : la phase de capture les recoit quand meme.
    bloc.addEventListener('load', reajuster, true)
    bloc.addEventListener('toggle', reajuster, true)
    bloc.addEventListener('change', reajuster)
    let largeurVue = bloc.getBoundingClientRect().width
    const observateur =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const largeur = bloc.getBoundingClientRect().width
            if (Math.abs(largeur - largeurVue) < 0.5) return
            largeurVue = largeur
            reajuster()
          })
        : null
    observateur?.observe(bloc)
    return () => {
      observateur?.disconnect()
      bloc.removeEventListener('load', reajuster, true)
      bloc.removeEventListener('toggle', reajuster, true)
      bloc.removeEventListener('change', reajuster)
    }
  }, [ref, contenu])
}
