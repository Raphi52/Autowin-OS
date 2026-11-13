import { useEffect, useRef } from 'react'
import { creerCadence, estAuRepos } from './decor-cadence'
import { doitRedimensionner } from './decor-redimension'
import { creerSceneQuartier, type SceneQuartier } from '../quartier/quartier-scene'
import { signalerSceneSousLaBarre } from '../theme-mode'

/**
 * LE FOND DE L'APPLICATION : LE QUARTIER.
 *
 * La scène monte à la racine de la coque, en `fixed`, derrière tout le contenu : il n'y a qu'un fond,
 * et c'est lui. Le Quartier est le seul fond depuis le 2026-11-13 (« on doit avoir que le fond Le
 * Quartier ») : les anciennes scènes 3D et leur menu ont été retirés.
 *
 * SUSPENSION : la boucle s'arrete quand le document est CACHE (fenetre minimisee, autre onglet), et en
 * veille hors de l'Accueil (`decor-veille.ts`).
 */
export function DecorDeFond({ actif = true }: { actif?: boolean }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** La scène montée, pour la réveiller quand l'Accueil revient (voir `decor-veille.ts`). */
  const decorRef = useRef<DecorMonte | null>(null)
  /** Lu par la boucle d'images à chaque battement : hors de l'Accueil, elle s'arrête. */
  const actifRef = useRef(actif)

  useEffect(() => {
    actifRef.current = actif
    if (actif) decorRef.current?.reprendre()
  }, [actif])

  /*
   * LES BOUTONS DE FENETRE suivent ce qui est sous eux : la scene affichee sur l'Accueil les
   * eclaircit dans un theme clair ; une autre vue ou le decor demonte les rend au theme. Voir
   * `signalerSceneSousLaBarre` dans theme-mode.ts.
   */
  useEffect(() => {
    signalerSceneSousLaBarre(actif)
    return () => signalerSceneSousLaBarre(false)
  }, [actif])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    /*
     * UNE SEULE CONSTRUCTION, MEME SOUS STRICTMODE (2026-10-17).
     *
     * En developpement, `<StrictMode>` (main.tsx) monte cet effet, le demonte et le remonte
     * AUSSITOT, d'un seul tenant (`commitDoubleInvokeEffectsInDEV`, pile relevee par sonde CDP).
     * Construire ici sur-le-champ batissait donc DEUX scenes a chaque ouverture de l'Accueil, la
     * premiere jetee a la poubelle 0,2 a 0,8 s plus tard -- sur la machine de l'utilisateur, qui fait
     * tourner Autowin en developpement. La construction part donc en MICROTACHE, et le nettoyage
     * l'annule : seule la derniere programmation survit au double montage. En production, rien ne
     * change de visible -- une microtache s'execute avant la prochaine image.
     */
    let annule = false
    queueMicrotask(() => {
      if (annule) return
      decorRef.current = monterDecor(host, () => actifRef.current)
    })
    return () => {
      annule = true
      decorRef.current?.arreter()
      decorRef.current = null
    }
  }, [])

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
 * l'Accueil). Rend `null` sans toile 2D (happy-dom en test).
 */
function monterDecor(host: HTMLDivElement, estActif: () => boolean): DecorMonte | null {
  const scene: SceneQuartier | null = creerSceneQuartier()
  // Pas de toile (happy-dom en test) : l'app s'affiche sans decor, ce qui est le comportement
  // voulu — un decor n'est pas une dependance de la fonction.
  if (!scene) return null
  host.appendChild(scene.canvas)

  /**
   * Redimensionne le decor, PUIS le redessine.
   *
   * Le redessin n'est pas une precaution : sans lui, le decor disparait. Cause localisee le
   * 2026-08-21 sur une machine ou « reduire les animations » est ACTIF — celle de l'utilisateur.
   * Redimensionner une toile vide son contenu : redimensionner repositionnait donc correctement
   * tous les elements sur une toile que plus personne ne remplissait.
   */
  let derniereTaille: { w: number; h: number } | null = null
  const fit = (): void => {
    const w = host.clientWidth
    const h = host.clientHeight
    // L'observateur notifie a la moindre secousse de mise en page, taille identique comprise :
    // redimensionner pour rien figeait la fenetre (5,6 s et 6,3 s mesurees le 2026-09-08).
    if (!doitRedimensionner(derniereTaille, w, h)) return
    derniereTaille = { w, h }
    scene.resize(w, h)
    scene.render(performance.now() / 1000)
  }
  fit()
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
  observer?.observe(host)
  window.addEventListener('resize', fit)

  /**
   * LE REPOS : fenetre sans le focus, ou aucun geste depuis `REPOS_APRES_MS` → la cadence
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
    // Suspendu quand le document est CACHE : dessiner pour une fenetre que personne ne regarde
    // coute pour rien.
    if (typeof document !== 'undefined' && document.hidden) return
    cadence.repos(
      estAuRepos(
        time,
        dernierGeste,
        typeof document.hasFocus === 'function' ? document.hasFocus() : true
      )
    )
    if (!cadence.doitDessiner(time)) return
    /*
     * LE TEMPS DU DECOR EST L'HORLOGE REELLE, « mouvement reduit » ou non (2026-10-19).
     * Sur un PC ou les « Effets d'animation » de Windows sont coupes, Chromium annonce
     * `prefers-reduced-motion: reduce`. Le decor ralentissait alors son temps d'un facteur 0,25 :
     * plainte « le fond d'ecran 3d de l'accueil defile super lentement ». Decision de l'utilisateur :
     * le fond garde sa vitesse normale quel que soit ce reglage. Avant encore, un temps FIGE sous
     * cette preference rendait le nuage immobile : ni fige, ni ralenti, donc.
     * Garde : DecorDeFond.vitesse.test.tsx.
     */
    // Le cout de l'image est pris sur l'interface : la cadence s'espace pour lui en laisser la moitie.
    const debut = performance.now()
    scene.render(time / 1000)
    cadence.noterCout(performance.now() - debut)
    // Repère lisible par CDP : le coût réel de chaque image, mesuré sur le poste par
    // scripts/sonde-cout-image-accueil.mjs. Tampon borné à 300 entrées, vidé au-delà.
    performance.measure('decor:image', { start: debut })
    if (performance.getEntriesByName('decor:image').length > 300)
      performance.clearMeasures('decor:image')
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
      GESTES.forEach((nom) => window.removeEventListener(nom, geste))
      window.removeEventListener('focus', geste)
      window.removeEventListener('resize', fit)
      observer?.disconnect()
      scene.dispose()
    }
  }
}
