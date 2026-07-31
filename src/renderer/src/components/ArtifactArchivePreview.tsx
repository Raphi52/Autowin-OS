import { useMemo } from 'react'
import { strFromU8, unzipSync, type UnzipFileFilter } from 'fflate'
import type { ChatArtifact } from '../../../shared/artifacts'

const MAX_ARCHIVE_ENTRIES = 500
const MAX_ARCHIVE_INFLATED_BYTES = 64 * 1024 * 1024

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function unzipBounded(content: string): Record<string, Uint8Array> {
  let entries = 0
  let inflated = 0
  const filter: UnzipFileFilter = (file) => {
    entries += 1
    inflated += file.originalSize
    return entries <= MAX_ARCHIVE_ENTRIES && inflated <= MAX_ARCHIVE_INFLATED_BYTES
  }
  return unzipSync(base64Bytes(content), { filter })
}

function xmlText(file: Uint8Array | undefined): string {
  return file ? strFromU8(file) : ''
}

function xmlDocument(xml: string): Document | undefined {
  if (!xml) return undefined
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  return document.querySelector('parsererror') ? undefined : document
}

function textBySuffix(document: Document | undefined, suffix: string): string[] {
  if (!document) return []
  return [...document.getElementsByTagName('*')]
    .filter((element) => element.localName === suffix)
    .map((element) => element.textContent ?? '')
}

function documentPreview(files: Record<string, Uint8Array>): React.JSX.Element {
  const document = xmlDocument(xmlText(files['word/document.xml'] ?? files['content.xml']))
  const ordered = document
    ? [...document.getElementsByTagName('*')]
        .filter((element) => element.localName === 'p')
        .map((paragraph) =>
          [...paragraph.getElementsByTagName('*')]
            .filter((element) => element.localName === 't')
            .map((element) => element.textContent ?? '')
            .join('')
        )
        .filter(Boolean)
    : []
  return (
    <article className="artifact-office-document">
      {ordered.slice(0, 200).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </article>
  )
}

function presentationPreview(files: Record<string, Uint8Array>): React.JSX.Element {
  let slides = Object.entries(files)
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(([left], [right]) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
    )
  if (!slides.length && files['content.xml']) slides = [['content.xml', files['content.xml']]]
  return (
    <div className="artifact-slides">
      {slides.slice(0, 80).map(([name, file], index) => {
        const text = textBySuffix(xmlDocument(xmlText(file)), 't')
        return (
          <section className="artifact-slide" key={name}>
            <span>{index + 1}</span>
            <div>
              {text.map((line, lineIndex) => (
                <p key={lineIndex}>{line}</p>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function spreadsheetPreview(files: Record<string, Uint8Array>): React.JSX.Element {
  const shared = textBySuffix(xmlDocument(xmlText(files['xl/sharedStrings.xml'])), 't')
  const sheetName = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]
  const document = xmlDocument(xmlText(sheetName ? files[sheetName] : files['content.xml']))
  const rows = document
    ? [...document.getElementsByTagName('*')]
        .filter((element) => element.localName === 'row' || element.localName === 'table-row')
        .slice(0, 200)
        .map((row) =>
          [...row.children]
            .filter((element) => element.localName === 'c' || element.localName === 'table-cell')
            .slice(0, 50)
            .map((cell) => {
              const value = [...cell.getElementsByTagName('*')].find(
                (element) => element.localName === 'v'
              )?.textContent
              if (cell.localName === 'table-cell') return cell.textContent?.trim() ?? ''
              return cell.getAttribute('t') === 's' ? (shared[Number(value)] ?? '') : (value ?? '')
            })
        )
    : []
  return (
    <div className="artifact-table-wrap">
      <table>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ArtifactArchivePreview({
  artifact
}: {
  artifact: ChatArtifact
}): React.JSX.Element {
  const result = useMemo(() => {
    if (!artifact.content || artifact.encoding !== 'base64')
      return { error: 'Contenu d’archive indisponible' } as const
    if (artifact.mimeType === 'application/rtf') {
      try {
        const source = new TextDecoder().decode(base64Bytes(artifact.content))
        return {
          legacyText: source
            .replace(/\\par[d]?/g, '\n')
            .replace(/\\'[0-9a-f]{2}/gi, '')
            .replace(/\\[a-z]+-?\d* ?/gi, '')
            .replace(/[{}]/g, '')
            .trim()
        } as const
      } catch {
        return { error: 'Document RTF illisible' } as const
      }
    }
    try {
      return { files: unzipBounded(artifact.content) } as const
    } catch {
      return { error: 'Archive illisible ou format non pris en charge' } as const
    }
  }, [artifact.content, artifact.encoding, artifact.mimeType])

  if ('error' in result) return <div className="artifact-preview__blocked">{result.error}</div>
  if ('legacyText' in result)
    return <article className="artifact-office-document">{result.legacyText}</article>
  if (artifact.kind === 'document') return documentPreview(result.files)
  if (artifact.kind === 'presentation') return presentationPreview(result.files)
  if (artifact.kind === 'spreadsheet') return spreadsheetPreview(result.files)

  const entries = Object.entries(result.files)
  return (
    <div className="artifact-archive">
      <div className="artifact-archive__summary">{entries.length} éléments inspectés</div>
      {entries.slice(0, 500).map(([name, content]) => (
        <div className="artifact-archive__entry" key={name}>
          <span title={name}>{name}</span>
          <small>{content.byteLength.toLocaleString('fr-FR')} o</small>
        </div>
      ))}
    </div>
  )
}
