import { useMemo } from 'react'
import type { ArtifactKind, ChatArtifact } from '../../../shared/artifacts'
import { BrainMarkdown } from './BrainMarkdown'
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
        cells?: Array<{ cell_type?: string; source?: string[] | string }>
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
        </section>
      ))}
    </div>
  )
}

function ArtifactBody({ artifact }: { artifact: ChatArtifact }): React.JSX.Element {
  const text = inlineText(artifact)
  const dataUrl = inlineDataUrl(artifact)

  if ((artifact.kind === 'image' || artifact.kind === 'vector') && dataUrl)
    return <img className="artifact-preview__image" src={dataUrl} alt={artifact.name} />
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
      <iframe
        className="artifact-preview__frame"
        title={`Aperçu de ${artifact.name}`}
        sandbox="allow-scripts"
        srcDoc={text}
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
    (artifact.kind === 'code' ||
      artifact.kind === 'diff' ||
      artifact.kind === 'text' ||
      artifact.kind === 'diagram') &&
    text !== undefined
  )
    return <pre className={`artifact-preview__source is-${artifact.kind}`}>{text}</pre>
  if (artifact.kind === 'font')
    return <div className="artifact-preview__font">Aa Bb Cc · 0123456789</div>
  if (artifact.kind === 'model3d')
    return <div className="artifact-preview__placeholder">Scène 3D · aperçu interactif</div>
  if (artifact.kind === 'archive')
    return (
      <div className="artifact-preview__placeholder">
        Archive · contenu inspectable sans exécution
      </div>
    )
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
    return (
      <div className="artifact-preview__placeholder">
        {LABELS[artifact.kind]} · aperçu du fichier
      </div>
    )
  return (
    <div className="artifact-preview__placeholder">
      {artifact.path ? 'Fichier conservé sur le disque' : 'Aperçu indisponible'}
    </div>
  )
}

export function ArtifactPreview({ artifact }: { artifact: ChatArtifact }): React.JSX.Element {
  return (
    <article className="artifact-preview" data-artifact-kind={artifact.kind}>
      <header className="artifact-preview__header">
        <span className="artifact-preview__kind">{LABELS[artifact.kind]}</span>
        <strong title={artifact.name}>{artifact.name}</strong>
        <span>{fileSize(artifact.size)}</span>
      </header>
      <div className="artifact-preview__body">
        <ArtifactBody artifact={artifact} />
      </div>
      <footer className="artifact-preview__footer">
        <span>{artifact.mimeType}</span>
        <span>
          {artifact.source.provider}
          {artifact.source.model ? ` · ${artifact.source.model}` : ''}
        </span>
      </footer>
    </article>
  )
}
