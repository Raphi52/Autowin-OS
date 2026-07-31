// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatArtifact } from '../../../shared/artifacts'
import { ArtifactPreview } from './ArtifactPreview'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

function artifact(overrides: Partial<ChatArtifact>): ChatArtifact {
  return {
    id: `artifact-${overrides.name ?? 'test'}`,
    name: overrides.name ?? 'test.txt',
    mimeType: overrides.mimeType ?? 'text/plain',
    kind: overrides.kind ?? 'text',
    size: overrides.size ?? 4,
    createdAt: 1,
    source: { provider: 'claude', model: 'opus-test' },
    ...overrides
  }
}

describe('ArtifactPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(value: ChatArtifact): void {
    act(() => root.render(<ArtifactPreview artifact={value} />))
  }

  it('renders image, markdown, table and structured data previews', () => {
    render(
      artifact({
        name: 'capture.png',
        mimeType: 'image/png',
        kind: 'image',
        encoding: 'base64',
        content: 'YWJj'
      })
    )
    expect(container.querySelector('img.artifact-preview__image')).not.toBeNull()

    render(
      artifact({
        name: 'RUN.md',
        mimeType: 'text/markdown',
        kind: 'markdown',
        encoding: 'utf8',
        content: '## Besoin\n\n**Visible**'
      })
    )
    expect(container.querySelector('.brain-markdown h2')?.textContent).toBe('Besoin')

    render(
      artifact({
        name: 'data.csv',
        mimeType: 'text/csv',
        kind: 'table',
        encoding: 'utf8',
        content: 'nom,valeur\nalpha,42'
      })
    )
    expect(container.querySelector('table')?.textContent).toContain('alpha')

    render(
      artifact({
        name: 'result.json',
        mimeType: 'application/json',
        kind: 'structured-data',
        encoding: 'utf8',
        content: '{"ok":true}'
      })
    )
    expect(container.querySelector('pre')?.textContent).toContain('"ok": true')
  })

  it('sandboxes web output and provides native media/document viewers', () => {
    render(
      artifact({
        name: 'index.html',
        mimeType: 'text/html',
        kind: 'web',
        encoding: 'utf8',
        content: '<button>Démo</button>'
      })
    )
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')

    render(
      artifact({
        name: 'rapport.pdf',
        mimeType: 'application/pdf',
        kind: 'pdf',
        encoding: 'base64',
        content: 'JVBERg=='
      })
    )
    expect(container.querySelector('[data-artifact-viewer="pdf"]')).not.toBeNull()

    render(
      artifact({
        name: 'voix.mp3',
        mimeType: 'audio/mpeg',
        kind: 'audio',
        encoding: 'base64',
        content: 'YWJj'
      })
    )
    expect(container.querySelector('audio[controls]')).not.toBeNull()

    render(
      artifact({
        name: 'demo.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        encoding: 'base64',
        content: 'YWJj'
      })
    )
    expect(container.querySelector('video[controls]')).not.toBeNull()
  })

  it('never offers execution for executables or unknown binaries', () => {
    render(
      artifact({
        name: 'outil.exe',
        mimeType: 'application/x-msdownload',
        kind: 'executable',
        path: 'C:\\workspace\\outil.exe'
      })
    )
    expect(container.textContent).toContain('Exécution interdite')
    expect(container.querySelector('[data-action="execute"]')).toBeNull()
    expect(container.querySelector('iframe,object,embed')).toBeNull()
  })
})
