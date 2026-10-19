import { useEffect, useState } from 'react'
import type { ChatArtifact } from '../../../shared/artifacts'
import { ICONE_IMAGE } from './ArtifactPreview'
import {
  fileSize,
  inlineDataUrl,
  kindLabel,
  nomRepeteLeLibelle,
  partiesDistinctes
} from './artifact-outils'
import { RondDIcone } from './anneau-activite'
import { Spinner } from './Spinner'

/* PILE D'IMAGES (conv-332, 2026-10-18).
   Demande : « un moyen de grouper ces blocs car souvent ils s'enchainent » — six images lues à la
   suite faisaient six capsules empilées, environ 390 px de fil pour un seul geste. Choix sur
   maquettes : « implémente la 2 + 6 quand déployed ».
   - REPLIÉE = proposition 2 « Pile de cartes » : la DERNIÈRE image devant, avec le balisage et les
     classes des capsules (`thinking-block`, `cadre-anneau`…), donc le même dessin que les autres
     capsules dans chaque thème ; une pastille « +N » et deux bords qui dépassent dessous.
   - DÉPLOYÉE = proposition 6 « Planche contact » : une bande de vignettes, une par image, dans la
     capsule ; un clic sur une vignette l'agrandit (même visionneuse que la capsule seule).
   Repliée, AUCUNE image n'est chargée (règle des capsules, choix du 27/08) : une vignette ne lit son
   fichier qu'une fois la pile ouverte, puisqu'elle n'existe qu'à ce moment-là. */

type OuvrirImage = (image: { src: string; name: string }) => void

/** Adresse affichable d'une image : directe si elle est déjà dans l'artefact, sinon lue sur disque. */
function useApercu(
  artifact: ChatArtifact,
  conversationId: string | null | undefined,
  turnId: string | undefined
): { src?: string; error?: string } {
  const direct = inlineDataUrl(artifact)
  const lecture = window.api?.readChatArtifact
  const lisible =
    !direct &&
    artifact.content === undefined &&
    Boolean(artifact.path) &&
    Boolean(conversationId) &&
    Boolean(turnId) &&
    Boolean(lecture)
  const cle = `${conversationId ?? ''}\u0000${turnId ?? ''}\u0000${artifact.id}`
  const [etat, setEtat] = useState<{ cle: string; src?: string; error?: string }>()

  useEffect(() => {
    if (!lisible || !conversationId || !turnId || !window.api?.readChatArtifact) return
    let actif = true
    void window.api
      .readChatArtifact(conversationId, turnId, artifact.id)
      .then((result) => {
        if (!actif) return
        const src =
          result.ok && result.content !== undefined
            ? inlineDataUrl({
                ...(result.artifact ?? artifact),
                content: result.content,
                encoding: result.encoding
              })
            : undefined
        setEtat(src ? { cle, src } : { cle, error: result.error ?? 'Aperçu indisponible' })
      })
      .catch(() => {
        if (actif) setEtat({ cle, error: 'Lecture de l’artefact impossible' })
      })
    return () => {
      actif = false
    }
  }, [artifact, cle, conversationId, lisible, turnId])

  if (direct) return { src: direct }
  if (!lisible) return { error: 'Aperçu indisponible' }
  return etat?.cle === cle ? etat : {}
}

function Vignette({
  artifact,
  legende,
  conversationId,
  turnId,
  onOpenImage
}: {
  artifact: ChatArtifact
  legende: string
  conversationId?: string | null
  turnId?: string
  onOpenImage?: OuvrirImage
}): React.JSX.Element {
  const { src, error } = useApercu(artifact, conversationId, turnId)
  return (
    <button
      type="button"
      className="artifact-pile__vignette"
      title={artifact.name}
      aria-label={`Agrandir ${artifact.name}`}
      onClick={() => {
        if (src) onOpenImage?.({ src, name: artifact.name })
      }}
    >
      <span className="artifact-pile__apercu">
        {src ? (
          <img src={src} alt="" />
        ) : error ? (
          <span className="artifact-pile__erreur">{error}</span>
        ) : (
          <Spinner />
        )}
      </span>
      <span className="artifact-pile__legende">
        <b>{legende}</b> · {fileSize(artifact.size)}
      </span>
    </button>
  )
}

export function ArtifactPile({
  artifacts,
  conversationId,
  turnId,
  onOpenImage,
  live = false
}: {
  artifacts: ChatArtifact[]
  conversationId?: string | null
  turnId?: string
  onOpenImage?: OuvrirImage
  /** Tour en cours : la pile reste vive comme les autres capsules ; tour fini, elle pâlit avec elles. */
  live?: boolean
}): React.JSX.Element {
  const [ouverte, setOuverte] = useState(false)
  const devant = artifacts[artifacts.length - 1]
  const autres = artifacts.length - 1
  const libelle = kindLabel(devant)
  const derniere = devant.source.tool === 'Read' ? 'la dernière lue' : 'la plus récente'
  const nom = nomRepeteLeLibelle(devant.name, libelle) ? derniere : `${devant.name} · ${derniere}`
  const noms = artifacts.map((artifact) => artifact.name)
  // Des noms tous identiques (anciens artefacts au nom fabriqué) ne distinguent rien : numéros.
  const legendes =
    new Set(noms).size === 1
      ? artifacts.map((_, index) => String(index + 1))
      : partiesDistinctes(noms)
  const etat = live ? ' is-live' : ' is-done'

  return (
    <div
      className={`artifact-pile${ouverte ? ' is-ouverte' : ''}${etat}`}
      data-images={artifacts.length}
    >
      <details
        className={`thinking-block thinking-block--deux-lignes cadre-anneau artifact-capsule${etat}`}
        data-artifact-kind={devant.kind}
        data-collapsed={ouverte ? undefined : 'true'}
        open={ouverte}
      >
        <summary
          className="artifact-capsule__entete"
          onClick={(event) => {
            event.preventDefault()
            setOuverte((courant) => !courant)
          }}
        >
          <span className="anneau-tete">
            <RondDIcone>{ICONE_IMAGE}</RondDIcone>
            <span className="anneau-col">
              <span className="anneau-l1">
                <span className="thinking-label artifact-capsule__provenance">{libelle}</span>
                <span className="thinking-duree">{fileSize(devant.size)}</span>
              </span>
              <span className="anneau-l2">
                <span className="thinking-status artifact-capsule__nom" title={devant.name}>
                  {nom}
                </span>
              </span>
            </span>
            <span
              className="artifact-pile__compte"
              aria-label={`et ${autres} autre${autres > 1 ? 's' : ''} image${autres > 1 ? 's' : ''}`}
            >
              +{autres}
            </span>
            <span className="anneau-chevron" aria-hidden="true" />
          </span>
        </summary>
        {ouverte && (
          <div className="artifact-pile__planche">
            {artifacts.map((artifact, index) => (
              <Vignette
                key={`${index}-${artifact.id}`}
                artifact={artifact}
                legende={legendes[index]}
                conversationId={conversationId}
                turnId={turnId}
                onOpenImage={onOpenImage}
              />
            ))}
          </div>
        )}
      </details>
      {!ouverte && (
        <span className="artifact-pile__tranches" aria-hidden="true">
          <span />
          <span />
        </span>
      )}
    </div>
  )
}
