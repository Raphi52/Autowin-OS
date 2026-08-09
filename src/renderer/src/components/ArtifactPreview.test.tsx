// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { ChatArtifact } from '../../../shared/artifacts'
import { ArtifactPreview } from './ArtifactPreview'
import { validateModel3dBytes } from './artifact-model3d-validation'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg><g class="node"></g><g class="node"></g></svg>'
  }))
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

  function render(
    value: ChatArtifact,
    props: {
      conversationId?: string
      turnId?: string
      onOpenImage?: (image: { src: string; name: string }) => void
    } = {}
  ): void {
    act(() => root.render(<ArtifactPreview artifact={value} {...props} />))
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
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')

    render(
      artifact({
        name: 'large.html',
        mimeType: 'text/html',
        kind: 'web',
        encoding: 'utf8',
        content: `<main>${'a'.repeat(1_000_001)}</main>`
      })
    )
    expect(container.querySelector('[data-testid="html-render-too-large"]')).toBeNull()
    expect(container.querySelector('iframe')?.getAttribute('src')).toMatch(/^data:text\/html/)

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

    render(
      artifact({
        name: 'payload.bin',
        mimeType: 'application/octet-stream',
        kind: 'binary',
        path: 'C:\\workspace\\payload.bin'
      })
    )
    expect(container.querySelector('[data-action="execute"]')).toBeNull()
    expect(container.querySelector('.artifact-preview__blocked')).not.toBeNull()
  })

  it('inspecte une archive et rend les formats Office OOXML sans les exécuter', () => {
    const archive = zipSync({
      'docs/readme.txt': strToU8('bonjour'),
      'images/logo.svg': strToU8('<svg/>')
    })
    render(
      artifact({
        name: 'livrables.zip',
        mimeType: 'application/zip',
        kind: 'archive',
        encoding: 'base64',
        content: Buffer.from(archive).toString('base64')
      })
    )
    expect(container.querySelector('.artifact-archive')?.textContent).toContain('docs/readme.txt')
    expect(container.querySelector('[data-action="extract"]')).toBeNull()

    const docx = zipSync({
      'word/document.xml': strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Rapport généré</w:t></w:r></w:p></w:body></w:document>'
      )
    })
    render(
      artifact({
        name: 'rapport.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        kind: 'document',
        encoding: 'base64',
        content: Buffer.from(docx).toString('base64')
      })
    )
    expect(container.querySelector('.artifact-office-document')?.textContent).toContain(
      'Rapport généré'
    )

    const pptx = zipSync({
      'ppt/slides/slide1.xml': strToU8(
        '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><a:t>Slide modèle</a:t></p:sld>'
      )
    })
    render(
      artifact({
        name: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        kind: 'presentation',
        encoding: 'base64',
        content: Buffer.from(pptx).toString('base64')
      })
    )
    expect(container.querySelector('.artifact-slide')?.textContent).toContain('Slide modèle')
    const xlsx = zipSync({
      'xl/sharedStrings.xml': strToU8(
        '<?xml version="1.0"?><sst><si><t>Valeur modele</t></si></sst>'
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c></row></sheetData></worksheet>'
      )
    })
    render(
      artifact({
        name: 'mesures.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        kind: 'spreadsheet',
        encoding: 'base64',
        content: Buffer.from(xlsx).toString('base64')
      })
    )
    expect(container.querySelector('table')?.textContent).toContain('Valeur modele')
  })

  it('rend texte, code, diff et notebook avec un repli lisible', () => {
    for (const kind of ['text', 'code', 'diff'] as const) {
      render(
        artifact({
          name: `preuve.${kind}`,
          kind,
          encoding: 'utf8',
          content: `${kind}-visible`
        })
      )
      expect(container.querySelector(`pre.is-${kind}`)?.textContent).toContain(`${kind}-visible`)
    }

    render(
      artifact({
        name: 'analyse.ipynb',
        mimeType: 'application/x-ipynb+json',
        kind: 'notebook',
        encoding: 'utf8',
        content: JSON.stringify({
          cells: [
            {
              cell_type: 'code',
              source: ['print(42)'],
              outputs: [{ output_type: 'stream', text: ['42\n'] }]
            }
          ]
        })
      })
    )
    expect(container.querySelector('.artifact-notebook')?.textContent).toContain('print(42)')
    expect(container.querySelector('.artifact-notebook')?.textContent).toContain('42')
  })

  it('rend un diagramme strict, une police et refuse un modele 3D amplificateur', async () => {
    render(
      artifact({
        name: 'flow.mmd',
        mimeType: 'text/vnd.mermaid',
        kind: 'diagram',
        encoding: 'utf8',
        content: 'flowchart LR\nA --> B'
      })
    )
    await act(async () => {})
    expect(
      container.querySelector('.artifact-diagram')?.getAttribute('data-diagram-security')
    ).toBe('strict')
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict' })
    )

    const fontLoad = vi.fn(async function (this: unknown) {
      return this
    })
    class TestFontFace {
      load = fontLoad
      constructor(
        public family: string,
        public source: string
      ) {}
    }
    Object.defineProperty(globalThis, 'FontFace', { value: TestFontFace, configurable: true })
    Object.defineProperty(document, 'fonts', {
      value: { add: vi.fn(), delete: vi.fn() },
      configurable: true
    })
    render(
      artifact({
        name: 'modele.woff2',
        mimeType: 'font/woff2',
        kind: 'font',
        encoding: 'base64',
        content: 'YWJj'
      })
    )
    await act(async () => {})
    expect(container.querySelector('.artifact-preview__font')?.textContent).toContain('Aa Bb Cc')

    const maliciousGltf = JSON.stringify({
      asset: { version: '2.0' },
      accessors: [{ count: 1_000_000, componentType: 5126, type: 'VEC3' }]
    })
    expect(
      validateModel3dBytes('amplification.gltf', new TextEncoder().encode(maliciousGltf))
    ).toContain('hors limites')
    expect(
      validateModel3dBytes(
        'remote.gltf',
        new TextEncoder().encode(
          JSON.stringify({
            asset: { version: '2.0' },
            buffers: [{ byteLength: 4, uri: 'https://attacker.invalid/model.bin' }]
          })
        )
      )
    ).toContain('ressource externe')
    expect(
      validateModel3dBytes(
        'polygon-bomb.obj',
        new TextEncoder().encode(`v 0 0 0\nf ${'1 '.repeat(100_000)}`)
      )
    ).toContain('hors limites')
    expect(
      validateModel3dBytes(
        'triangle.obj',
        new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3')
      )
    ).toBeUndefined()
    render(
      artifact({
        name: 'amplification.gltf',
        mimeType: 'model/gltf+json',
        kind: 'model3d',
        encoding: 'utf8',
        content: maliciousGltf
      })
    )
    await act(async () => {})
    expect(container.querySelector('.artifact-preview__blocked')).not.toBeNull()
  })

  it('maintient le rendu Mermaid strict face à une tentative de CSS hors diagramme', async () => {
    const hostile = `---
config:
  themeCSS: |-
    & + * { position: fixed !important; inset: 0 !important; }
---
graph TD
A`
    render(
      artifact({
        name: 'hostile.mmd',
        mimeType: 'text/vnd.mermaid',
        kind: 'diagram',
        encoding: 'utf8',
        content: hostile
      })
    )

    await act(async () => {})

    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict' })
    )
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), hostile)
    expect(container.querySelector('.artifact-diagram')?.children).toHaveLength(1)
  })

  it('agrandit une image et expose provenance, taille et revelation sure', () => {
    const onOpenImage = vi.fn()
    const reveal = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'api', {
      value: { revealChatArtifact: reveal },
      configurable: true
    })
    render(
      artifact({
        id: 'svg-1',
        name: 'schema.svg',
        mimeType: 'image/svg+xml',
        kind: 'vector',
        size: 2048,
        encoding: 'base64',
        content: 'PHN2Zy8+',
        path: 'C:\\store\\schema.svg'
      }),
      {
        conversationId: 'conv-1',
        turnId: 'turn-1',
        onOpenImage
      }
    )
    act(() =>
      container.querySelector<HTMLButtonElement>('.artifact-preview__image-button')?.click()
    )
    expect(onOpenImage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'schema.svg',
        src: expect.stringContaining('data:image/svg')
      })
    )
    expect(container.textContent).toContain('2.0 Ko')
    expect(container.textContent).toContain('claude')
    act(() => container.querySelector<HTMLButtonElement>('.artifact-preview__reveal')?.click())
    expect(reveal).toHaveBeenCalledWith('conv-1', 'turn-1', 'svg-1')
  })

  it('ne charge un fichier durable qu’à proximité du viewport', async () => {
    let intersect: IntersectionObserverCallback | undefined
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback
      }
      observe(): void {
        return undefined
      }
      disconnect(): void {
        return undefined
      }
      unobserve(): void {
        return undefined
      }
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
      root = null
      rootMargin = '600px 0px'
      thresholds = [0]
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: TestIntersectionObserver
    })
    const read = vi.fn(async () => ({
      ok: true,
      encoding: 'utf8' as const,
      content: 'contenu différé'
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { readChatArtifact: read }
    })
    render(
      artifact({
        id: 'lazy-1',
        name: 'lazy.txt',
        kind: 'text',
        content: undefined,
        encoding: undefined,
        path: 'C:\\store\\lazy.txt'
      }),
      { conversationId: 'conv-1', turnId: 'turn-1' }
    )
    expect(read).not.toHaveBeenCalled()

    await act(async () => {
      intersect?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)
    expect(container.querySelector('pre.is-text')?.textContent).toBe('contenu différé')
  })
})
