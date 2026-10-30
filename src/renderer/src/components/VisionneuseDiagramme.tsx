import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'
import {
  TAILLE_DE_SECOURS,
  facteurDeMolette,
  tailleDuSvg,
  vueAjustee,
  zoomerAutourDe,
  type Point,
  type Taille,
  type Vue
} from './zoom-diagramme'
import './VisionneuseDiagramme.css'

/** Un clic sur + ou −, ou ces touches au clavier. */
const FACTEUR_BOUTON = 1.4
const FACTEUR_DOUBLE_CLIC = 2

/**
 * Un événement React remonte l'arbre des COMPOSANTS, même à travers un portail : sans ce mur, un
 * clic ici arriverait aux gestes du fil qui entoure le schéma.
 */
const resterIci = (event: React.SyntheticEvent): void => event.stopPropagation()

/**
 * LA GRANDE VUE D'UN SCHÉMA (conv-1322, 2026-10-30). Dans le fil, la hauteur d'un schéma reste
 * plafonnée (`.md-mermaid svg`, conv-590) : à 420 px, celui de conv-1321 sortait avec un texte de
 * 5 px. Ici il prend toute la fenêtre, se zoome et se déplace.
 *
 * `transform` plutôt qu'une largeur : mermaid a calé son texte à sa taille naturelle, et un
 * changement de largeur le ferait recouper. Le navigateur repeint en net à chaque échelle.
 *
 * Fond opaque de la couleur du thème, et pas le voile noir des images : les couleurs d'un schéma
 * sont calculées pour ce fond (`theme-mermaid.ts`), et son texte serait noir sur noir en thème clair.
 */
export function VisionneuseDiagramme({
  svg,
  onFermer
}: {
  svg: string
  onFermer: () => void
}): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const racineRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const dessin = useMemo(() => tailleDuSvg(svg) ?? TAILLE_DE_SECOURS, [svg])
  const [vue, setVue] = useState<Vue>({ echelle: 1, x: 0, y: 0 })
  /** Tant que l'utilisateur n'a pas bougé le schéma, il suit la taille de la fenêtre. */
  const suitLaFenetreRef = useRef(true)
  const dernierPointRef = useRef<Point | null>(null)
  /**
   * Un double clic ne zoome que s'il a COMMENCÉ ici. Celui qui ouvre la vue depuis le fil finit dans
   * la scène : le schéma s'ouvrait déjà à 132 % au lieu de 66 % (sonde de conv-1322).
   */
  const clicDansLaSceneRef = useRef(false)

  const tailleDeLaScene = (): Taille => ({
    largeur: sceneRef.current?.clientWidth ?? 0,
    hauteur: sceneRef.current?.clientHeight ?? 0
  })

  const ajuster = useCallback(() => {
    suitLaFenetreRef.current = true
    setVue(vueAjustee(dessin, tailleDeLaScene()))
  }, [dessin])

  const zoomer = useCallback((facteur: number, point?: Point) => {
    suitLaFenetreRef.current = false
    const { largeur, hauteur } = tailleDeLaScene()
    const centre = point ?? { x: largeur / 2, y: hauteur / 2 }
    setVue((courante) => zoomerAutourDe(courante, facteur, centre))
  }, [])

  // L'observateur répond une première fois dès qu'il est branché, entre la mise en page et le dessin
  // de l'écran, puis suit la fenêtre. `flushSync` applique l'échelle AVANT ce dessin : sans lui,
  // React la poserait après, et le schéma apparaîtrait une image à la mauvaise taille.
  useLayoutEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const observateur = new ResizeObserver(() => {
      if (suitLaFenetreRef.current) flushSync(ajuster)
    })
    observateur.observe(scene)
    return () => observateur.disconnect()
  }, [ajuster])

  // `preventScroll` : ni l'ouverture ni le retour du focus ne doivent faire sauter le fil derrière.
  useEffect(() => {
    const precedent = document.activeElement
    racineRef.current?.focus({ preventScroll: true })
    return () => {
      if (precedent instanceof HTMLElement) precedent.focus({ preventScroll: true })
    }
  }, [])

  // Le clavier se lit AVANT tout le monde : Échap ferme la grande vue, et rien d'autre derrière elle.
  useEffect(() => {
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onFermer()
        return
      }
      // Ctrl + « + » et compagnie restent le zoom de toute l'app (App.tsx).
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === '+' || event.key === '=') zoomer(FACTEUR_BOUTON)
      else if (event.key === '-') zoomer(1 / FACTEUR_BOUTON)
      else if (event.key === '0') ajuster()
    }
    document.addEventListener('keydown', surTouche, true)
    return () => document.removeEventListener('keydown', surTouche, true)
  }, [ajuster, onFermer, zoomer])

  // Écouteur natif : celui de React est passif et ne peut pas empêcher le défilement. L'arrêt de la
  // propagation garde Ctrl + molette (et le pincement du pavé tactile) sur le schéma, là où App.tsx
  // zoomerait toute l'app.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const surMolette = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const boite = scene.getBoundingClientRect()
      zoomer(facteurDeMolette(event.deltaY, event.ctrlKey), {
        x: event.clientX - boite.left,
        y: event.clientY - boite.top
      })
    }
    scene.addEventListener('wheel', surMolette, { passive: false })
    return () => scene.removeEventListener('wheel', surMolette)
  }, [zoomer])

  const surPointeurEnfonce = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    suitLaFenetreRef.current = false
    dernierPointRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const surPointeurDeplace = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dernier = dernierPointRef.current
    if (!dernier) return
    const { clientX, clientY } = event
    dernierPointRef.current = { x: clientX, y: clientY }
    setVue((courante) => ({
      ...courante,
      x: courante.x + clientX - dernier.x,
      y: courante.y + clientY - dernier.y
    }))
  }

  const relacher = (): void => {
    dernierPointRef.current = null
  }

  const surDoubleClic = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!clicDansLaSceneRef.current) return
    const boite = event.currentTarget.getBoundingClientRect()
    zoomer(FACTEUR_DOUBLE_CLIC, { x: event.clientX - boite.left, y: event.clientY - boite.top })
  }

  return createPortal(
    <div
      ref={racineRef}
      className="visionneuse-diagramme"
      data-testid="visionneuse-diagramme"
      role="dialog"
      aria-modal="true"
      aria-label={t('diagramme.visionneuse')}
      tabIndex={-1}
      onClick={resterIci}
      onDoubleClick={resterIci}
      onMouseDown={resterIci}
      onMouseUp={resterIci}
    >
      <div className="visionneuse-diagramme__barre">
        <span className="visionneuse-diagramme__aide">{t('diagramme.aide')}</span>
        <button
          type="button"
          data-testid="visionneuse-zoom-moins"
          title={t('diagramme.zoomMoins')}
          aria-label={t('diagramme.zoomMoins')}
          onClick={() => zoomer(1 / FACTEUR_BOUTON)}
        >
          −
        </button>
        <output className="visionneuse-diagramme__zoom" data-testid="visionneuse-zoom">
          {t('diagramme.pourcent', { pourcent: Math.round(vue.echelle * 100) })}
        </output>
        <button
          type="button"
          data-testid="visionneuse-zoom-plus"
          title={t('diagramme.zoomPlus')}
          aria-label={t('diagramme.zoomPlus')}
          onClick={() => zoomer(FACTEUR_BOUTON)}
        >
          +
        </button>
        <button type="button" data-testid="visionneuse-ajuster" onClick={ajuster}>
          {t('diagramme.ajuster')}
        </button>
        <button
          type="button"
          data-testid="visionneuse-fermer"
          title={t('diagramme.fermer')}
          aria-label={t('diagramme.fermer')}
          onClick={onFermer}
        >
          ×
        </button>
      </div>
      <div
        ref={sceneRef}
        className="visionneuse-diagramme__scene"
        data-testid="visionneuse-scene"
        onPointerDown={surPointeurEnfonce}
        onPointerMove={surPointeurDeplace}
        onPointerUp={relacher}
        onPointerCancel={relacher}
        // `detail` compte les clics : 2 ici, c'est le second clic d'un double clic parti d'ailleurs.
        onMouseDown={(event) => {
          if (event.detail === 1) clicDansLaSceneRef.current = true
        }}
        onDoubleClick={surDoubleClic}
      >
        <div
          className="visionneuse-diagramme__toile"
          data-testid="visionneuse-toile"
          style={{
            width: dessin.largeur,
            height: dessin.hauteur,
            transform: `translate(${vue.x}px, ${vue.y}px) scale(${vue.echelle})`
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body
  )
}
