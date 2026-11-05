/**
 * CE QUI N'EST PAS À L'ÉCRAN NE S'ANIME PAS (conv-1610, 2026-11-05).
 *
 * Demande : « Garde la fluidité, mais seulement sur ce qui est visible et sur ma dernière bulle »,
 * après « autowin OS est full laggy ». Depuis la levée du plafond de 10 images/s (conv-1512), les
 * animations continues sont fluides. Mesure sur la fenêtre réelle (port de débogage) : 118
 * animations tournaient, la fenêtre prenait 101 % d'un cœur et la carte graphique 93 % ; tout mis
 * en pause, 7 % et 8 %. Chromium continue de faire tourner une animation sortie du champ (bulle
 * remontée hors du fil, fil de la liste masqué par le défilement) : elle garde la fenêtre à 60
 * images/s sans que personne ne la voie.
 *
 * LE GESTE : chaque élément qui démarre une animation CONTINUE (`infinite`) est suivi par un
 * IntersectionObserver sans racine — il tient compte de chaque conteneur qui défile au-dessus de
 * l'élément. Sorti du champ, ses animations continues sont mises en pause ; revenu, elles repartent
 * à la phase où elles seraient sans la pause (départ restauré), ce qui garde aussi les clignotements
 * calés ensemble sur l'horloge commune (animations-par-crans.ts).
 *
 * Les animations FINIES (entrées, atterrissages) ne sont jamais touchées : plusieurs vues attendent
 * leur `animationend` pour avancer (entree-cascade.ts, anneau-activite.tsx, TestsView.tsx).
 */

/** Ce qu'on lit et pilote d'une animation : sa cible, sa durée de vie, sa lecture et son départ. */
export type AnimationPilotable = {
  playState: string
  startTime: CSSNumberish | null
  effect: { target?: Element | null; getTiming?: () => { iterations?: number } } | null
  pause: () => void
  play: () => void
}

type Element2 = Element & { getAnimations?: (options?: { subtree?: boolean }) => unknown[] }

/** Une animation continue (`infinite`) portée par `element` lui-même ou par ses ::before / ::after. */
export function animationsContinuesDe(element: Element): AnimationPilotable[] {
  const getAnimations = (element as Element2).getAnimations
  if (typeof getAnimations !== 'function') return []
  // `subtree` : celles d'un pseudo-élément ne sortent qu'ainsi (même remarque qu'animations-par-crans).
  return (getAnimations.call(element, { subtree: true }) as AnimationPilotable[]).filter(
    (a) => a.effect?.target === element && a.effect.getTiming?.().iterations === Infinity
  )
}

/** Au-delà de ce nombre d'éléments suivis ajoutés, on oublie ceux qui ont quitté le document. */
const BALAYAGE_TOUS_LES = 200

/**
 * Écoute le démarrage de toute animation CSS du document et met en pause les animations continues
 * de ce qui sort du champ. Installé une fois, avant le premier rendu (main.tsx). Rend de quoi se
 * désinstaller (tests).
 */
export function installerPauseHorsChamp(cible: Document = document): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined
  /** Animations mises en pause par ce module, avec leur départ d'origine. */
  const enPause = new WeakMap<
    Element,
    { animation: AnimationPilotable; depart: CSSNumberish | null }[]
  >()
  const horsChamp = new WeakSet<Element>()
  const suivis = new Set<Element>()
  let ajoutsDepuisBalayage = 0

  const suspendre = (element: Element): void => {
    const liste = enPause.get(element) ?? []
    for (const animation of animationsContinuesDe(element)) {
      if (animation.playState !== 'running') continue
      liste.push({ animation, depart: animation.startTime })
      animation.pause()
    }
    if (liste.length > 0) enPause.set(element, liste)
  }
  const reprendre = (element: Element): void => {
    for (const { animation, depart } of enPause.get(element) ?? []) {
      // Une pause posée par quelqu'un d'autre depuis (ou une animation remplacée) n'est pas la nôtre.
      if (animation.playState !== 'paused') continue
      animation.play()
      if (depart !== null) animation.startTime = depart
    }
    enPause.delete(element)
  }
  const oublier = (element: Element): void => {
    observateur.unobserve(element)
    suivis.delete(element)
    horsChamp.delete(element)
    enPause.delete(element)
  }

  const observateur = new IntersectionObserver((entrees) => {
    for (const entree of entrees) {
      const element = entree.target
      if (!element.isConnected) {
        oublier(element)
        continue
      }
      if (entree.isIntersecting) {
        horsChamp.delete(element)
        reprendre(element)
      } else {
        horsChamp.add(element)
        suspendre(element)
      }
    }
  })

  const auDemarrage = (evenement: Event): void => {
    const element = evenement.target
    if (!(element instanceof Element)) return
    if (animationsContinuesDe(element).length === 0) return
    if (!suivis.has(element)) {
      suivis.add(element)
      observateur.observe(element)
      if (++ajoutsDepuisBalayage >= BALAYAGE_TOUS_LES) {
        ajoutsDepuisBalayage = 0
        for (const vieux of [...suivis]) if (!vieux.isConnected) oublier(vieux)
      }
    } else if (horsChamp.has(element)) {
      // Animation (re)créée sur un élément déjà hors champ (classe réécrite par React) :
      // l'observateur ne redira rien tant qu'il ne revient pas, on la suspend tout de suite.
      suspendre(element)
    }
  }
  // En capture : un `stopPropagation` posé plus bas ne doit pas laisser tourner une animation cachée.
  cible.addEventListener('animationstart', auDemarrage, true)
  return () => {
    cible.removeEventListener('animationstart', auDemarrage, true)
    observateur.disconnect()
    for (const element of suivis) reprendre(element)
    suivis.clear()
  }
}
