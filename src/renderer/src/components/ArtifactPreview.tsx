import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatArtifact } from '../../../shared/artifacts'
import { chatMediaUrl } from '../../../shared/chat-media'
import {
  useTextesArtefactsEtBandeaux,
  type CleArtefactsEtBandeaux
} from '../textes-ecrans/artefacts-et-bandeaux'
import { fileSize, inlineDataUrl, kindLabel, nomRepeteLeLibelle } from './artifact-outils'
import { BrainMarkdown } from './BrainMarkdown'
import { ArtifactArchivePreview } from './ArtifactArchivePreview'
import { ArtifactDiagramPreview } from './ArtifactDiagramPreview'
import { ArtifactFontPreview } from './ArtifactFontPreview'
import { ArtifactModel3dPreview } from './ArtifactModel3dPreview'
import { SandboxedHtmlPreview } from './SandboxedHtmlPreview'
import { ArtifactVideoPlayer } from './ArtifactVideoPlayer'
import { RondDIcone } from './anneau-activite'
import './ArtifactPreview.css'
import { Spinner } from './Spinner'

/** Cadre photo (soleil + montagnes) : l'icône du rond de la capsule d'image, au trait de l'icône
 *  Raisonnement de ThinkingBlock.tsx (16 × 16, `currentColor`). */
export const ICONE_IMAGE = (
  <svg viewBox="0 0 16 16" focusable="false">
    <rect
      x="1.75"
      y="2.75"
      width="12.5"
      height="10.5"
      rx="1.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="5.6" cy="6.2" r="1.35" fill="currentColor" />
    <path d="M2.6 12.4 L6.4 8.6 L8.9 11 L10.9 9 L13.4 11.5 V12.4 Z" fill="currentColor" />
  </svg>
)

function inlineText(artifact: ChatArtifact): string | undefined {
  if (artifact.content === undefined) return undefined
  if (artifact.encoding === 'utf8') return artifact.content
  try {
    const binary = atob(artifact.content)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === separator && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  row.push(cell)
  if (row.some(Boolean)) rows.push(row)
  return rows.slice(0, 200).map((cells) => cells.slice(0, 40))
}

function StructuredData({ text }: { text: string }): React.JSX.Element {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }, [text])
  return <pre className="artifact-preview__source">{formatted}</pre>
}

function NotebookPreview({ text }: { text: string }): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const notebook = useMemo(() => {
    try {
      return JSON.parse(text) as {
        cells?: Array<{
          cell_type?: string
          source?: string[] | string
          outputs?: Array<{
            output_type?: string
            text?: string[] | string
            data?: Record<string, string[] | string>
          }>
        }>
      }
    } catch {
      return null
    }
  }, [text])
  if (!notebook) return <pre className="artifact-preview__source">{text}</pre>
  return (
    <div className="artifact-notebook">
      {(notebook.cells ?? []).slice(0, 30).map((cell, index) => (
        <section
          className={`artifact-notebook__cell is-${cell.cell_type ?? 'unknown'}`}
          key={index}
        >
          <span>{cell.cell_type ?? t('apercu.cellule')}</span>
          <pre>{Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')}</pre>
          {(cell.outputs ?? []).slice(0, 12).map((output, outputIndex) => {
            const outputText =
              output.text ?? output.data?.['text/plain'] ?? output.data?.['text/markdown']
            const image = output.data?.['image/png'] ?? output.data?.['image/jpeg']
            const normalizedText = Array.isArray(outputText) ? outputText.join('') : outputText
            const normalizedImage = Array.isArray(image) ? image.join('') : image
            return normalizedImage ? (
              <img
                className="artifact-notebook__output-image"
                key={outputIndex}
                src={`data:${output.data?.['image/png'] ? 'image/png' : 'image/jpeg'};base64,${normalizedImage}`}
                alt={t('apercu.sortie', { rang: outputIndex + 1 })}
              />
            ) : normalizedText ? (
              <pre className="artifact-notebook__output" key={outputIndex}>
                {normalizedText}
              </pre>
            ) : null
          })}
        </section>
      ))}
    </div>
  )
}

function ArtifactBody({
  artifact,
  onOpenImage
}: {
  artifact: ChatArtifact
  onOpenImage?: (image: { src: string; name: string }) => void
}): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const text = inlineText(artifact)
  const dataUrl = inlineDataUrl(artifact)

  if ((artifact.kind === 'image' || artifact.kind === 'vector') && dataUrl)
    return (
      <button
        type="button"
        className="artifact-preview__image-button"
        aria-label={t('apercu.agrandir', { nom: artifact.name })}
        onClick={() => onOpenImage?.({ src: dataUrl, name: artifact.name })}
      >
        <img className="artifact-preview__image" src={dataUrl} alt={artifact.name} />
      </button>
    )
  if (artifact.kind === 'markdown' && text !== undefined) return <BrainMarkdown source={text} />
  if (artifact.kind === 'table' && text !== undefined) {
    const rows = parseDelimited(text, artifact.mimeType.includes('tab-separated') ? '\t' : ',')
    return (
      <div className="artifact-table-wrap">
        <table>
          <thead>
            <tr>
              {(rows[0] ?? []).map((cell, index) => (
                <th key={index}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (artifact.kind === 'structured-data' && text !== undefined)
    return <StructuredData text={text} />
  if (artifact.kind === 'notebook' && text !== undefined) return <NotebookPreview text={text} />
  if (artifact.kind === 'web' && text !== undefined)
    return (
      <SandboxedHtmlPreview
        source={text}
        title={t('apercu.apercuDe', { nom: artifact.name })}
        embedded
        enforceInlineLimit={false}
      />
    )
  if (artifact.kind === 'pdf' && dataUrl)
    return (
      <iframe
        className="artifact-preview__document"
        data-artifact-viewer="pdf"
        title={`PDF ${artifact.name}`}
        src={dataUrl}
      />
    )
  if (artifact.kind === 'audio' && dataUrl)
    return <audio className="artifact-preview__media" controls src={dataUrl} />
  if (artifact.kind === 'video' && dataUrl)
    return <ArtifactVideoPlayer artifact={artifact} src={dataUrl} />
  if (
    (artifact.kind === 'code' || artifact.kind === 'diff' || artifact.kind === 'text') &&
    text !== undefined
  )
    return <pre className={`artifact-preview__source is-${artifact.kind}`}>{text}</pre>
  if (artifact.kind === 'diagram' && text !== undefined)
    return <ArtifactDiagramPreview source={text} />
  if (artifact.kind === 'font') return <ArtifactFontPreview artifact={artifact} />
  if (artifact.kind === 'model3d') return <ArtifactModel3dPreview artifact={artifact} />
  if (artifact.kind === 'archive') return <ArtifactArchivePreview artifact={artifact} />
  if (artifact.kind === 'executable')
    return <div className="artifact-preview__blocked">{t('apercu.executionInterdite')}</div>
  if (artifact.kind === 'binary')
    return <div className="artifact-preview__blocked">{t('apercu.binaireNonExecute')}</div>
  if (
    artifact.kind === 'document' ||
    artifact.kind === 'presentation' ||
    artifact.kind === 'spreadsheet'
  )
    return <ArtifactArchivePreview artifact={artifact} />
  return (
    <div className="artifact-preview__placeholder">
      {artifact.path ? t('apercu.fichierConserve') : t('apercu.indisponible')}
    </div>
  )
}

export function ArtifactPreview({
  artifact,
  conversationId,
  turnId,
  onOpenImage,
  displayName,
  sourceLabel,
  provenanceLabel,
  previewError,
  live = false
}: {
  artifact: ChatArtifact
  conversationId?: string | null
  turnId?: string
  onOpenImage?: (image: { src: string; name: string }) => void
  displayName?: string
  sourceLabel?: string
  /** Libellé de provenance imposé par l'appelant (ex. « Image envoyée »). Prime sur l'inférence. */
  provenanceLabel?: string
  previewError?: string
  /** Tour encore en cours : la capsule d'image reste vive, comme Raisonnement / Actions ; tour fini,
   *  elle pâlit avec elles. */
  live?: boolean
}): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const cardRef = useRef<HTMLElement | null>(null)
  // Les aperçus visuels mangeaient tout le fil : repliés par défaut, dépliables à la demande.
  const isCollapsible = artifact.kind === 'image' || artifact.kind === 'vector'
  // Une image qu'on ne peut pas montrer s'ouvre sur son message d'erreur : replié, il serait caché.
  const [isExpanded, setIsExpanded] = useState(() => isCollapsible && Boolean(previewError))
  const [loadState, setLoadState] = useState<{
    key: string
    artifact?: ChatArtifact
    /** Message du processus principal, montré tel quel. */
    error?: string
    /** Échec dit par l'interface : traduit au rendu, il suit un changement de langue (conv-1170). */
    erreurLocale?: CleArtefactsEtBandeaux
  }>()
  /* VIDÉO ET SON CONSERVÉS = LUS PAR PLAGES (kaizen conv-260, 2026-10-11). La copie base64 de
     `readChatArtifact` est plafonnée à 16 Mo : la pub de 74,6 Mo du tour
     41ab69ad-0ff8-4a45-8ecd-efb9be30e4a2 n'aurait jamais eu de lecteur. Le lecteur reçoit une
     adresse `autowin-media://` faite du seul triplet d'identité ; le processus principal retrouve
     le fichier dans le stockage du fil et le sert par morceaux. */
  const mediaParPlages =
    (artifact.kind === 'video' || artifact.kind === 'audio') &&
    artifact.content === undefined &&
    Boolean(artifact.path) &&
    Boolean(conversationId) &&
    Boolean(turnId)
  const mustLoad =
    !mediaParPlages &&
    artifact.content === undefined &&
    Boolean(artifact.path) &&
    artifact.kind !== 'executable' &&
    artifact.kind !== 'binary'
  const [isNearViewport, setIsNearViewport] = useState(
    () => !mustLoad || typeof IntersectionObserver === 'undefined'
  )
  const loadKey = `${conversationId ?? ''}\u0000${turnId ?? ''}\u0000${artifact.id}`

  useEffect(() => {
    if (!mustLoad || isNearViewport || typeof IntersectionObserver === 'undefined') return
    const card = cardRef.current
    if (!card) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [isNearViewport, mustLoad])

  useEffect(() => {
    let active = true
    if (!mustLoad || !isNearViewport || !conversationId || !turnId || !window.api?.readChatArtifact)
      return
    void window.api
      .readChatArtifact(conversationId, turnId, artifact.id)
      .then((result) => {
        if (!active) return
        if (!result.ok || result.content === undefined) {
          setLoadState(
            typeof result.error === 'string'
              ? { key: loadKey, error: result.error }
              : { key: loadKey, erreurLocale: 'apercu.indisponible' }
          )
          return
        }
        setLoadState({
          key: loadKey,
          artifact: {
            ...(result.artifact ?? artifact),
            content: result.content,
            encoding: result.encoding
          }
        })
      })
      .catch(() => {
        if (active) setLoadState({ key: loadKey, erreurLocale: 'apercu.lectureImpossible' })
      })
    return () => {
      active = false
    }
  }, [artifact, conversationId, isNearViewport, loadKey, mustLoad, turnId])

  const activeLoadState = loadState?.key === loadKey ? loadState : undefined
  const loaded = activeLoadState?.artifact
  const loadError =
    activeLoadState?.error ??
    (activeLoadState?.erreurLocale ? t(activeLoadState.erreurLocale) : undefined)
  const mediaUrl =
    mediaParPlages && conversationId && turnId
      ? chatMediaUrl(conversationId, turnId, artifact.id)
      : undefined
  const parPlages = useMemo(
    () => (mediaUrl ? { ...artifact, url: mediaUrl } : undefined),
    [artifact, mediaUrl]
  )
  const resolved = loaded ?? parPlages ?? artifact
  const setCardRef = (element: HTMLElement | null): void => {
    cardRef.current = element
  }

  const body = (
    <div className="artifact-preview__body">
      {previewError ? (
        <div className="artifact-preview__blocked">{previewError}</div>
      ) : mustLoad && !isNearViewport ? (
        <div className="artifact-preview__placeholder">{t('apercu.chargeALApproche')}</div>
      ) : mustLoad && !loaded && !loadError ? (
        <div className="artifact-preview__placeholder" role="status">
          <Spinner /> {t('apercu.chargement')}
        </div>
      ) : loadError ? (
        <div className="artifact-preview__blocked">{loadError}</div>
      ) : (
        <ArtifactBody artifact={resolved} onOpenImage={onOpenImage} />
      )}
    </div>
  )

  const footer = (
    <footer className="artifact-preview__footer">
      <span>{resolved.mimeType}</span>
      <span>
        {sourceLabel ??
          `${resolved.source.provider}${resolved.source.model ? ` · ${resolved.source.model}` : ''}`}
      </span>
      {artifact.path && conversationId && turnId && (
        <button
          type="button"
          className="artifact-preview__reveal"
          onClick={(event) => {
            // Sans ce retour, un fichier déplacé/supprimé donnait un clic totalement muet :
            // rien ne s'ouvre, aucune explication. On reporte l'échec sur le bouton lui-même.
            const button = event.currentTarget
            void Promise.resolve(
              window.api?.revealChatArtifact?.(conversationId, turnId, artifact.id)
            ).catch((error: unknown) => {
              button.textContent = t('apercu.fichierIntrouvable')
              button.title = error instanceof Error ? error.message : String(error)
            })
          }}
        >
          {t('apercu.afficherFichier')}
        </button>
      )}
    </footer>
  )

  /* IMAGE EN CAPSULE (conv-178, 2026-10-10 : « les blocs images lues / image envoyée, mets-leur
     la même gueule que les capsules Action et Raisonnement »). Ce n'est PAS une copie de leur
     style : on reprend leur BALISAGE et leurs classes (`thinking-block`, `thinking-capsule`…),
     donc ChatView.css et chaque thème les dessinent à l'identique, et toute retouche future des
     capsules s'applique aussi aux images. Libellé de provenance et poids en première ligne, nom
     du fichier sur la seconde, à la place du signe de vie (conv-907, voir plus bas).
     Replié = plus AUCUN pixel d'aperçu (choix utilisateur du 27/08) : le corps n'est rendu
     qu'ouvert. L'ouverture est pilotée ici (clic intercepté) : l'image ne se charge qu'à la
     demande, et l'état reste juste au clavier comme à la souris. */
  /* DEUX LIGNES (conv-907, 2026-10-12 : « comme les capsules raisonnement actions etc je veux que
     le titre de l'image soit dans la capsule dans une ligne en dessous »). La capsule prend le
     cadre de BlocRepliable (ThinkingBlock.tsx) : le rond degrade et son icone a gauche, le libelle
     et le poids en premiere ligne, le NOM du fichier dessous, DANS le cadre, puis le chevron. Un
     nom qui redit le libelle n'ouvre pas de seconde ligne vide. */
  if (isCollapsible) {
    const libelle = provenanceLabel ?? kindLabel(resolved)
    const nomVisible = displayName ?? artifact.name
    return (
      <details
        ref={setCardRef}
        className={`thinking-block thinking-block--deux-lignes cadre-anneau artifact-capsule${live ? ' is-live' : ' is-done'}`}
        data-artifact-kind={artifact.kind}
        data-collapsed={isExpanded ? undefined : 'true'}
        open={isExpanded}
      >
        <summary
          className="artifact-capsule__entete"
          onClick={(event) => {
            event.preventDefault()
            setIsExpanded((current) => !current)
          }}
        >
          <span className="anneau-tete">
            <RondDIcone>{ICONE_IMAGE}</RondDIcone>
            <span className="anneau-col">
              <span className="anneau-l1">
                <span className="thinking-label artifact-capsule__provenance">{libelle}</span>
                <span className="thinking-duree">{fileSize(artifact.size)}</span>
              </span>
              {!nomRepeteLeLibelle(nomVisible, libelle) && (
                <span className="anneau-l2">
                  <span className="thinking-status artifact-capsule__nom" title={artifact.name}>
                    {nomVisible}
                  </span>
                </span>
              )}
            </span>
            <span className="anneau-chevron" aria-hidden="true" />
          </span>
        </summary>
        {isExpanded && (
          <div className="artifact-capsule__corps">
            {body}
            {footer}
          </div>
        )}
      </details>
    )
  }

  return (
    <article ref={setCardRef} className="artifact-preview" data-artifact-kind={artifact.kind}>
      <header className="artifact-preview__header">
        <span className="artifact-preview__kind">{provenanceLabel ?? kindLabel(resolved)}</span>
        <strong title={artifact.name}>{displayName ?? artifact.name}</strong>
        <span>{fileSize(artifact.size)}</span>
      </header>
      {body}
      {footer}
    </article>
  )
}
