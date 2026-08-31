import { useEffect, useRef } from 'react'
import { autowinStorageKey } from '../storage-keys'
import {
  createDecorScene,
  DECOR_DEFAUT,
  tempsDecor,
  type DecorScene,
  type DecorVariant
} from './home-decor-scene'

/**
 * LA MEME CLE QUE LA VUE ACCUEIL, obtenue par le meme helper -- et pas une chaine recopiee.
 *
 * Premiere version de ce fichier : j'avais ecrit `'autowin:decor-variant'` a la main, alors que
 * `HomeView` lisait `autowinStorageKey('home.decor.v2')`. Les deux ne coincident pas : la direction
 * choisie par l'utilisateur aurait ete ignoree en silence, et le decor serait toujours reparti sur le
 * defaut. Une cle de stockage se derive, elle ne se recopie pas.
 *
 * `v2` ET NON `v1` : la cle a ete versionnee le 2026-08-25, APRES l'ecriture de ce fichier, pour que
 * le nouveau defaut `actuel` atteigne les machines ayant deja choisi `poussiere` (plainte « je vois
 * des poussieres »). Reprendre `v1` ici aurait ressuscite l'ancien choix.
 */
const DECOR_STORAGE_KEY = autowinStorageKey('home.decor.v2')

/**
 * LE DECOR 3D, FOND DE TOUTE L'APPLICATION.
 *
 * DEMANDE DE L'UTILISATEUR, formulee deux fois : « faut enlever le fond d'ecran 2d et tout remplacer
 * par du 3d », puis « ya encore le fond decran 2d ». Il avait raison les deux fois. Le `body` peignait
 * `autowin-galaxy-bg-hq.png` en `cover fixed` -- une image PLATE, sans profondeur ni reaction au
 * pointeur -- sur TOUTES les vues, tandis que le decor three.js ne vivait que dans `HomeView`.
 *
 * CE QUE CE COMPOSANT CHANGE : la scene monte a la racine de la coque, en `fixed`, derriere tout le
 * contenu. Elle devient le fond de chaque vue, et le PNG est retire. Il n'y a plus deux fonds qui se
 * disputent la place -- il n'y en a qu'un, et il est en trois dimensions.
 *
 * SUSPENSION : la boucle s'arrete quand le document est CACHE (fenetre minimisee, autre onglet), pas
 * quand une autre vue est affichee. C'est la difference avec la version d'avant, ou le decor
 * n'appartenait qu'a l'Accueil : un fond d'application doit vivre partout, sinon ce n'est pas un fond.
 */
export function DecorDeFond(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const choisie = (window.localStorage.getItem(DECOR_STORAGE_KEY) ?? DECOR_DEFAUT) as DecorVariant
    const scene: DecorScene | null = createDecorScene(choisie)
    // Pas de WebGL (happy-dom en test, pilote absent) : l'app s'affiche sans decor, ce qui est le
    // comportement voulu — un decor n'est pas une dependance de la fonction.
    if (!scene) return
    host.appendChild(scene.canvas)

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /**
     * Redimensionne le decor, PUIS le redessine.
     *
     * Le redessin n'est pas une precaution : sans lui, le decor disparait. Cause localisee le
     * 2026-08-21 sur une machine ou « reduire les animations » est ACTIF — celle de l'utilisateur.
     * `renderer.setSize` realloue le tampon de dessin : redimensionner repositionnait donc
     * correctement tous les elements sur un tampon que plus personne ne remplissait.
     */
    const fit = (): void => {
      scene.resize(host.clientWidth, host.clientHeight)
      scene.render(tempsDecor(performance.now() / 1000, reduceMotion), { x: 0, y: 0 })
    }
    fit()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    observer?.observe(host)
    window.addEventListener('resize', fit)

    const aim = { x: 0, y: 0 }
    const look = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent): void => {
      aim.x = (event.clientX / window.innerWidth - 0.5) * 2
      aim.y = (event.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onPointerMove)

    let frame = 0
    let last = 0
    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw)
      // Suspendu quand le document est CACHE : faire tourner un rendu 3D pour une fenetre que
      // personne ne regarde coute un GPU entier pour rien. Mais une autre VUE affichee ne suspend
      // plus rien — c'est desormais le fond de l'application, pas celui d'un ecran.
      if (typeof document !== 'undefined' && document.hidden) return
      // ~40 images/s : la scene derive lentement, doubler la cadence ne se voit pas et double la
      // facture d'une fenetre qui reste ouverte toute la journee.
      if (time - last < 25) return
      last = time
      look.x += (aim.x - look.x) * 0.05
      look.y += (aim.y - look.y) * 0.05
      /*
       * « MOUVEMENT REDUIT » REDUIT LE MOUVEMENT, il n'efface pas le decor. Le temps est RALENTI et
       * non FIGE : le figer rendait le nuage immobile (plainte « le nuage est statique », conv-1476),
       * le decor n'ayant pas d'autre horloge. Le ralentissement vit dans `tempsDecor`. La parallaxe
       * curseur reste : elle ne bouge QUE quand l'utilisateur bouge, c'est de la manipulation directe.
       */
      scene.render(tempsDecor(time / 1000, reduceMotion), look)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', fit)
      observer?.disconnect()
      scene.dispose()
    }
  }, [])

  return <div className="decor-de-fond" ref={hostRef} aria-hidden="true" />
}
