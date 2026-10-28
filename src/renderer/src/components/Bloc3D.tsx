/**
 * BLOC ```threejs DU FIL — une scene three.js VIVANTE, qu'on fait pivoter a la souris (demande
 * conv-299, 2026-10-16 : « je veux les planetes en three.js dans le chat, rendu reel »).
 *
 * Le code du bloc ne tourne JAMAIS dans la page de l'app : il est envoye a `scene-3d.html` (voir
 * `src/renderer/scene-3d/page-scene-3d.mjs`), chargee dans un cadre `sandbox="allow-scripts"`
 * sans `allow-same-origin`. Origine opaque : ni `window.api`, ni le DOM ni le stockage de l'app ;
 * la politique de la page coupe le reseau.
 *
 * Une scene n'est montee que quand elle est a l'ecran : chaque scene tient un contexte WebGL, et
 * Chromium en retire au-dela d'une quinzaine par page. Un long fil de maquettes 3D garderait sinon
 * toutes ses scenes allumees, et ferait aussi tourner leurs animations pour rien.
 */
import { useEffect, useRef, useState } from 'react'
import { NOM_PAGE_SCENE_3D, TYPE_MESSAGE_SCENE_3D } from '../../../shared/scene-3d'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'
import './Bloc3D.css'

// `message` absent : la scène n'a rien dit, « Erreur inconnue » est traduit au rendu (conv-1170).
type EtatScene = { etat: 'chargement' } | { etat: 'lancee' } | { etat: 'erreur'; message?: string }

/** Marge autour de la colonne a partir de laquelle une scene est montee ou demontee. */
const MARGE_VISIBILITE = '300px 0px'

export function Bloc3D({ code }: { code: string }): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const hoteRef = useRef<HTMLElement>(null)
  const cadreRef = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [mode, setMode] = useState<'scene' | 'source'>('scene')
  const [version, setVersion] = useState(0)
  const [agrandi, setAgrandi] = useState(false)
  const [etat, setEtat] = useState<EtatScene>({ etat: 'chargement' })
  const montee = visible && mode === 'scene'

  useEffect(() => {
    const hote = hoteRef.current
    if (!hote || typeof IntersectionObserver === 'undefined') return
    const observateur = new IntersectionObserver(
      (entrees) => setVisible(entrees.some((entree) => entree.isIntersecting)),
      { rootMargin: MARGE_VISIBILITE }
    )
    observateur.observe(hote)
    return () => observateur.disconnect()
  }, [])

  useEffect(() => {
    if (!montee) return
    const ecouter = (event: MessageEvent): void => {
      const cadre = cadreRef.current?.contentWindow
      // Seul NOTRE cadre parle a ce bloc : un autre bloc 3D du fil, ou n'importe quelle page, est
      // ignore meme s'il imite le format.
      if (!cadre || event.source !== cadre) return
      const donnees = event.data as { type?: unknown; etat?: unknown; message?: unknown } | null
      if (!donnees || donnees.type !== TYPE_MESSAGE_SCENE_3D) return
      if (donnees.etat === 'pret') {
        // Origine opaque : aucune cible plus precise que '*' n'existe. Le destinataire est fixe
        // par la reference du cadre, pas par l'origine.
        cadre.postMessage({ type: TYPE_MESSAGE_SCENE_3D, code }, '*')
      } else if (donnees.etat === 'lancee') {
        setEtat((courant) => (courant.etat === 'erreur' ? courant : { etat: 'lancee' }))
      } else if (donnees.etat === 'erreur') {
        setEtat({
          etat: 'erreur',
          message:
            donnees.message === undefined || donnees.message === null
              ? undefined
              : String(donnees.message)
        })
      }
    }
    window.addEventListener('message', ecouter)
    return () => window.removeEventListener('message', ecouter)
  }, [montee, code, version])

  const relancer = (): void => {
    setMode('scene')
    setEtat({ etat: 'chargement' })
    setVersion((valeur) => valeur + 1)
  }

  return (
    <section
      ref={hoteRef}
      className={`bloc-3d${agrandi ? ' is-agrandi' : ''}`}
      data-testid="chat-inline-scene-3d"
      aria-label={t('scene.titre')}
    >
      <header className="bloc-3d__barre">
        <span className="bloc-3d__nom">
          {t('scene.titre')}
          <span className="bloc-3d__aide">
            {mode === 'scene' ? t('scene.aideScene') : t('scene.aideSource')}
          </span>
        </span>
        <span className="bloc-3d__modes" role="group" aria-label={t('scene.modes')}>
          <button
            type="button"
            className={mode === 'scene' ? 'is-active' : ''}
            aria-pressed={mode === 'scene'}
            data-action="scene-3d-scene"
            onClick={() => setMode('scene')}
          >
            {t('scene.scene')}
          </button>
          <button
            type="button"
            className={mode === 'source' ? 'is-active' : ''}
            aria-pressed={mode === 'source'}
            data-action="scene-3d-source"
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </span>
        <button
          type="button"
          data-action="scene-3d-relancer"
          title={t('scene.relancer')}
          aria-label={t('scene.relancerAria')}
          onClick={relancer}
        >
          ↻
        </button>
        <button
          type="button"
          data-action="scene-3d-agrandir"
          aria-pressed={agrandi}
          onClick={() => setAgrandi((valeur) => !valeur)}
        >
          {agrandi ? t('commun.reduire') : t('commun.agrandir')}
        </button>
      </header>
      {etat.etat === 'erreur' && mode === 'scene' && (
        <p className="bloc-3d__erreur" role="alert" data-testid="scene-3d-erreur">
          {t('scene.plantee', { message: etat.message ?? t('scene.erreurInconnue') })}
        </p>
      )}
      {mode === 'source' ? (
        <pre className="bloc-3d__source">
          <code>{code}</code>
        </pre>
      ) : montee ? (
        <iframe
          key={version}
          ref={cadreRef}
          className="bloc-3d__cadre"
          data-testid="scene-3d-cadre"
          title={t('scene.cadre')}
          // Relative au document de l'app : `http://localhost:<port>/scene-3d.html` en
          // developpement, `file:///…/out/renderer/scene-3d.html` installee — l'adresse exacte que
          // le filtre de navigation de la fenetre accepte (isSceneFrameUrl).
          src={NOM_PAGE_SCENE_3D}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; xr-spatial-tracking 'none'"
        />
      ) : (
        // Hors de l'ecran : meme hauteur, aucun contexte WebGL tenu.
        <div className="bloc-3d__cadre bloc-3d__veille" aria-hidden="true" />
      )}
    </section>
  )
}
