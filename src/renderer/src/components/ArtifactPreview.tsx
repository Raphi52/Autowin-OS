import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactKind, ChatArtifact } from '../../../shared/artifacts'
import { BrainMarkdown } from './BrainMarkdown'
import { ArtifactArchivePreview } from './ArtifactArchivePreview'
import { ArtifactDiagramPreview } from './ArtifactDiagramPreview'
import { ArtifactFontPreview } from './ArtifactFontPreview'
import { ArtifactModel3dPreview } from './ArtifactModel3dPreview'
import { SandboxedHtmlPreview } from './SandboxedHtmlPreview'
import './ArtifactPreview.css'

const LABELS: Record<ArtifactKind, string> = {
  image: 'Image',
  vector: 'Vecteur',
  markdown: 'Markdown',
  text: 'Texte',
  code: 'Code',
  diff: 'Diff',
  'structured-data': 'Données',
  table: 'Tableau',
  diagram: 'Diagramme',
  pdf: 'PDF',
  document: 'Document',
  presentation: 'Présentation',
  spreadsheet: 'Tableur',
  notebook: 'Notebook',
  audio: 'Audio',
  video: 'Vidéo',
  web: 'Web',
  archive: 'Archive',
  model3d: '3D',
  font: 'Police',
  executable: 'Exécutable',
  binary: 'Binaire'
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

function inlineDataUrl(artifact: ChatArtifact): string | undefined {
  if (artifact.content === undefined || artifact.encoding !== 'base64') return undefined
  return `data:${artifact.mimeType};base64,${artifact.content}`
}

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
          <span>{cell.cell_type ?? 'cellule'}</span>
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
                alt={`Sortie ${outputIndex + 1}`}
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
  const text = inlineText(artifact)
  const dataUrl = inlineDataUrl(artifact)

  if ((artifact.kind === 'image' || artifact.kind === 'vector') && dataUrl)
    return (
      <button
        type="button"
        className="artifact-preview__image-button"
        aria-label={`Agrandir ${artifact.name}`}
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
        title={`Aperçu de ${artifact.name}`}
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
    return <video className="artifact-preview__video" controls src={dataUrl} />
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
    return (
      <div className="artifact-preview__blocked">Exécution interdite · métadonnées uniquement</div>
    )
  if (artifact.kind === 'binary')
    return (
      <div className="artifact-preview__blocked">Binaire non exécuté · métadonnées uniquement</div>
    )
  if (
    artifact.kind === 'document' ||
    artifact.kind === 'presentation' ||
    artifact.kind === 'spreadsheet'
  )
    return <ArtifactArchivePreview artifact={artifact} />
  return (
    <div className="artifact-preview__placeholder">
      {artifact.path ? 'Fichier conservé sur le disque' : 'Aperçu indisponible'}
    </div>
  )
}

export function ArtifactPreview({
  artifact,
  conversationId,
  turnId,
  onOpenImage
}: {
  artifact: ChatArtifact
  conversationId?: string | null
  turnId?: string
  onOpenImage?: (image: { src: string; name: string }) => void
}): React.JSX.Element {
  const cardRef = useRef<HTMLElement>(null)
  const [loadState, setLoadState] = useState<{
    key: string
    artifact?: ChatArtifact
    error?: string
  }>()
  const mustLoad =
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
          setLoadState({ key: loadKey, error: result.error ?? 'Aperçu indisponible' })
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
        if (active) setLoadState({ key: loadKey, error: 'Lecture de l’artefact impossible' })
      })
    return () => {
      active = false
    }
  }, [artifact, conversationId, isNearViewport, loadKey, mustLoad, turnId])

  const activeLoadState = loadState?.key === loadKey ? loadState : undefined
  const loaded = activeLoadState?.artifact
  const loadError = activeLoadState?.error
  const resolved = loaded ?? artifact

  return (
    <article ref={cardRef} className="artifact-preview" data-artifact-kind={artifact.kind}>
      <header className="artifact-preview__header">
        <span className="artifact-preview__kind">{LABELS[artifact.kind]}</span>
        <strong title={artifact.name}>{artifact.name}</strong>
        <span>{fileSize(artifact.size)}</span>
      </header>
      <div className="artifact-preview__body">
        {mustLoad && !isNearViewport ? (
          <div className="artifact-preview__placeholder">Aperçu chargé à l’approche</div>
        ) : mustLoad && !loaded && !loadError ? (
          <div className="artifact-preview__placeholder" role="status">
            Chargement de l’aperçu…
          </div>
        ) : loadError ? (
          <div className="artifact-preview__blocked">{loadError}</div>
        ) : (
          <ArtifactBody artifact={resolved} onOpenImage={onOpenImage} />
        )}
      </div>
      <footer className="artifact-preview__footer">
        <span>{resolved.mimeType}</span>
        <span>
          {resolved.source.provider}
          {resolved.source.model ? ` · ${resolved.source.model}` : ''}
        </span>
        {artifact.path && conversationId && turnId && (
          <button
            type="button"
            className="artifact-preview__reveal"
            onClick={() => {
              void window.api?.revealChatArtifact?.(conversationId, turnId, artifact.id)
            }}
          >
            Afficher le fichier
          </button>
        )}
      </footer>
    </article>
  )
}
