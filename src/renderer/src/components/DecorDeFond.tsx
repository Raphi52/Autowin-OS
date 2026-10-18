import { useEffect, useRef, useState } from 'react'
import { autowinStorageKey } from '../storage-keys'
import { creerCadence, estAuRepos } from './decor-cadence'
import { doitRedimensionner } from './decor-redimension'
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
 *
 * `v3` ET NON `v2`, meme raison le 2026-10-17 (conv-301) : le defaut devient l'avenue cyberpunk
 * (« Passe au vrai fond de l'Accueil avec ce look »). Une machine qui gardait `actuel` sous `v2`
 * aurait continue d'afficher les planetes, et la demande n'aurait jamais atteint l'ecran.
 */
const DECOR_STORAGE_KEY = autowinStorageKey('home.decor.v3')

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
export function DecorDeFond({ actif = true }: { actif?: boolean }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** La scène montée, pour la réveiller quand l'Accueil revient (voir `decor-veille.ts`). */
  const decorRef = useRef<DecorMonte | null>(null)
  /** Lu par la boucle d'images à chaque battement : hors de l'Accueil, elle s'arrête. */
  const actifRef = useRef(actif)
  /** La direction choisie, lue une fois : rien dans l'app ne la change pendant la session. */
  const [variante] = useState<DecorVariant>(() =>
    typeof window === 'undefined'
      ? DECOR_DEFAUT
      : ((window.localStorage.getItem(DECOR_STORAGE_KEY) ?? DECOR_DEFAUT) as DecorVariant)
  )

  /**
   * LE THEME APPLIQUE, mis en DEPENDANCE de la scene ci-dessous.
   *
   * La scene 3D lit les teintes du theme A SA CREATION (relireTeintesDuTheme dans
   * home-decor-scene.ts) et ne les relit jamais ensuite. Sans ce qui suit, changer de theme
   * laissait le decor sur les couleurs du precedent : constate a l ecran le 2026-09-07, la
   * nebuleuse bleu-magenta du sombre d origine restait affichee sous Obsidian Nebula.
   *
   * On RECONSTRUIT plutot que de muter les couleurs en place : les teintes sont figees dans des
   * geometries et des nuanceurs a la construction, les changer demanderait de parcourir toute la
   * scene -- beaucoup de code pour un geste rare. Le nettoyage existant (scene.dispose) est deja
   * correct, donc il n y a rien de plus a ecrire pour liberer l ancienne.
   */
  const [themeApplique, setThemeApplique] = useState<string>(() =>
    typeof document === 'undefined'
      ? ''
      : (document.documentElement.getAttribute('data-theme') ?? '')
  )

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
    const racine = document.documentElement
    const observateur = new MutationObserver(() => {
      setThemeApplique(racine.getAttribute('data-theme') ?? '')
    })
    observateur.observe(racine, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observateur.disconnect()
  }, [])

  /**
   * L'AVENUE NE LIT PAS LE THÈME (conv-337) : sa palette est la sienne, écrite dans
   * home-decor-avenue.ts, qui ne consulte aucune teinte du thème. La reconstruire à chaque
   * changement de thème recompilait la scène pour rien (2 à 3,7 s sans rue). Seules les directions
   * « spatiales », qui relisent les teintes à leur création, suivent encore le thème.
   */
  const cleTheme = variante === 'avenue' ? 'palette-propre' : themeApplique

  useEffect(() => {
    actifRef.current = actif
    if (actif) decorRef.current?.reprendre()
  }, [actif])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    /*
     * UNE SEULE CONSTRUCTION, MEME SOUS STRICTMODE (2026-10-17, conv-301).
     *
     * En developpement, `<StrictMode>` (main.tsx) monte cet effet, le demonte et le remonte
     * AUSSITOT, d'un seul tenant (`commitDoubleInvokeEffectsInDEV`, pile relevee par sonde CDP).
     * Construire ici sur-le-champ batissait donc DEUX scenes a chaque ouverture de l'Accueil : un
     * contexte WebGL, ~0,5 s de construction sur le fil principal et une compilation jetes a la
     * poubelle 0,2 a 0,8 s plus tard -- sur la machine de l'utilisateur, qui fait tourner Autowin en
     * developpement. La construction part donc en MICROTACHE, et le nettoyage l'annule : seule la
     * derniere programmation survit au double montage. En production, rien ne change de visible --
     * une microtache s'execute avant la prochaine image.
     */
    let annule = false
    queueMicrotask(() => {
      if (annule) return
      decorRef.current = monterDecor(host, variante, () => actifRef.current)
    })
    return () => {
      annule = true
      decorRef.current?.arreter()
      decorRef.current = null
    }
  }, [cleTheme, variante])

  // En veille, le décor est CACHÉ (style en ligne : il l'emporte sur les `display` des thèmes) et
  // sa boucle est arrêtée — rien n'est dessiné hors de l'Accueil.
  return (
    <div
      className="decor-de-fond"
      ref={hostRef}
      aria-hidden="true"
      style={actif ? undefined : { display: 'none' }}
    />
  )
}

/** Une scène montée : `arreter` la libère, `reprendre` relance sa boucle après une veille. */
interface DecorMonte {
  arreter(): void
  reprendre(): void
}

/**
 * Construit la scene dans `host`, lance sa boucle, et rend de quoi l'arreter, la liberer et la
 * reveiller. La boucle s'arrete d'elle-meme quand `estActif()` devient faux (veille hors de
 * l'Accueil). Rend `null` sans WebGL (happy-dom en test, pilote absent).
 */
function monterDecor(
  host: HTMLDivElement,
  choisie: DecorVariant,
  estActif: () => boolean
): DecorMonte | null {
  const scene: DecorScene | null = createDecorScene(choisie)
  // Pas de WebGL (happy-dom en test, pilote absent) : l'app s'affiche sans decor, ce qui est le
  // comportement voulu — un decor n'est pas une dependance de la fonction.
  if (!scene) return null
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
  let derniereTaille: { w: number; h: number } | null = null
  const fit = (): void => {
    const w = host.clientWidth
    const h = host.clientHeight
    // L'observateur notifie a la moindre secousse de mise en page, taille identique comprise. Or
    // `resize` realloue toute la chaine de post-traitement : le payer pour rien figeait la
    // fenetre (5,6 s et 6,3 s mesurees le 2026-09-08, sans tache longue JavaScript associee).
    if (!doitRedimensionner(derniereTaille, w, h)) return
    derniereTaille = { w, h }
    scene.resize(w, h)
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

  /**
   * LE REPOS (conv-337) : fenetre sans le focus, ou aucun geste depuis `REPOS_APRES_MS` → la cadence
   * passe a `IMAGES_PAR_SECONDE_REPOS`. Le premier geste (ou le retour du focus) la remonte.
   * Mesure qui le motive : 34 ms de calcul par image dans le fil du decor, soit les trois quarts d'un
   * coeur a 30 images/s, pour un Accueil qui reste ouvert des heures sans qu'on y touche.
   */
  let dernierGeste = performance.now()
  const geste = (): void => {
    dernierGeste = performance.now()
  }
  const GESTES = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
  GESTES.forEach((nom) => window.addEventListener(nom, geste, { passive: true }))
  window.addEventListener('focus', geste)

  let frame = 0
  let enBoucle = false
  // 30 images/s sur tous les ecrans, et jamais plus de la moitie du fil de l'interface : voir
  // decor-cadence.ts (l'ancien seuil de 25 ms donnait 30, 30 ou 36 images/s selon l'ecran).
  const cadence = creerCadence()
  const draw = (time: number): void => {
    // EN VEILLE hors de l'Accueil (decor-veille.ts) : la boucle s'arrete, rien n'est dessine.
    if (!estActif()) {
      enBoucle = false
      return
    }
    frame = requestAnimationFrame(draw)
    // Suspendu quand le document est CACHE : faire tourner un rendu 3D pour une fenetre que
    // personne ne regarde coute un GPU entier pour rien. Mais une autre VUE affichee ne suspend
    // plus rien — c'est desormais le fond de l'application, pas celui d'un ecran.
    if (typeof document !== 'undefined' && document.hidden) return
    cadence.repos(
      estAuRepos(
        time,
        dernierGeste,
        typeof document.hasFocus === 'function' ? document.hasFocus() : true
      )
    )
    // La scene derive lentement : au-dela de 30 images/s la difference ne se voit pas, la facture
    // d'une fenetre qui reste ouverte toute la journee, si.
    if (!cadence.doitDessiner(time)) return
    look.x += (aim.x - look.x) * 0.05
    look.y += (aim.y - look.y) * 0.05
    /*
     * « MOUVEMENT REDUIT » REDUIT LE MOUVEMENT, il n'efface pas le decor. Le temps est RALENTI et
     * non FIGE : le figer rendait le nuage immobile (plainte « le nuage est statique », conv-1476),
     * le decor n'ayant pas d'autre horloge. Le ralentissement vit dans `tempsDecor`. La parallaxe
     * curseur reste : elle ne bouge QUE quand l'utilisateur bouge, c'est de la manipulation directe.
     */
    // Ce que l'image coute au fil de l'interface : presque rien quand la scene se dessine dans un
    // Worker (l'avenue), tout son rendu sinon — la cadence s'espace alors d'elle-meme.
    const debut = performance.now()
    scene.render(tempsDecor(time / 1000, reduceMotion), look)
    cadence.noterCout(performance.now() - debut)
  }
  const reprendre = (): void => {
    if (enBoucle) return
    enBoucle = true
    // la fenetre a pu changer de taille pendant la veille (l'hote cache mesure 0 : ignore)
    fit()
    frame = requestAnimationFrame(draw)
  }
  reprendre()

  return {
    reprendre,
    arreter() {
      cancelAnimationFrame(frame)
      enBoucle = false
      window.removeEventListener('pointermove', onPointerMove)
      GESTES.forEach((nom) => window.removeEventListener(nom, geste))
      window.removeEventListener('focus', geste)
      window.removeEventListener('resize', fit)
      observer?.disconnect()
      scene.dispose()
    }
  }
}
