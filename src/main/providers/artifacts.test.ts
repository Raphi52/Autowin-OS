import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  artifactKindFor,
  artifactsFromExecutionEvidence,
  normalizeProviderArtifacts
} from './artifacts'

const scratch: string[] = []

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('provider artifacts', () => {
  it.each([
    ['capture.png', 'image/png', 'image'],
    ['logo.svg', 'image/svg+xml', 'vector'],
    ['RUN.md', 'text/markdown', 'markdown'],
    ['change.patch', 'text/x-diff', 'diff'],
    ['trace.jsonl', 'application/x-ndjson', 'structured-data'],
    ['export.csv', 'text/csv', 'table'],
    ['flow.mmd', 'text/x-mermaid', 'diagram'],
    ['rapport.pdf', 'application/pdf', 'pdf'],
    ['note.docx', '', 'document'],
    ['slides.pptx', '', 'presentation'],
    ['budget.xlsx', '', 'spreadsheet'],
    ['analyse.ipynb', '', 'notebook'],
    ['voix.mp3', 'audio/mpeg', 'audio'],
    ['demo.mp4', 'video/mp4', 'video'],
    ['index.html', 'text/html', 'web'],
    ['bundle.zip', 'application/zip', 'archive'],
    ['scene.glb', 'model/gltf-binary', 'model3d'],
    ['inter.woff2', 'font/woff2', 'font'],
    ['outil.exe', 'application/x-msdownload', 'executable'],
    ['opaque.bin', 'application/octet-stream', 'binary']
  ])('classifies %s as %s', (name, mimeType, expected) => {
    expect(artifactKindFor(name, mimeType)).toBe(expected)
  })

  it('normalizes inline supplier output with stable provenance', () => {
    const [artifact] = normalizeProviderArtifacts(
      [
        {
          name: 'capture.png',
          mimeType: 'image/png',
          content: 'YWJj',
          encoding: 'base64'
        }
      ],
      { provider: 'codex', model: 'gpt-test', now: () => 123 }
    )

    expect(artifact).toMatchObject({
      name: 'capture.png',
      mimeType: 'image/png',
      kind: 'image',
      size: 3,
      createdAt: 123,
      encoding: 'base64',
      content: 'YWJj',
      source: { provider: 'codex', model: 'gpt-test' }
    })
    expect(artifact.id).toMatch(/^artifact-/)
  })

  it('keeps generated files inside the execution workspace and rejects traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-artifacts-'))
    scratch.push(root)
    writeFileSync(join(root, 'report.md'), '# Preuve', 'utf8')

    const artifacts = normalizeProviderArtifacts(
      [{ path: 'report.md' }, { path: join(root, '..', 'outside.txt') }],
      { provider: 'claude', workspaceRoot: root, now: () => 456 }
    )

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      name: 'report.md',
      kind: 'markdown',
      path: join(root, 'report.md'),
      size: 8,
      source: { provider: 'claude', originalPath: join(root, 'report.md') }
    })
  })

  it('collects newly-created execution files without turning every source edit into an artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-evidence-artifacts-'))
    scratch.push(root)
    writeFileSync(join(root, 'capture.png'), Buffer.from('png'))
    writeFileSync(join(root, 'existing.ts'), 'export {}', 'utf8')

    const artifacts = artifactsFromExecutionEvidence(
      [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'files',
          workspaceRoot: root,
          paths: ['capture.png', 'existing.ts'],
          pathBaseFingerprints: { 'capture.png': null, 'existing.ts': 'tracked-before' }
        }
      ],
      { provider: 'codex', workspaceRoot: root, now: () => 789 }
    )

    expect(artifacts.map((artifact) => artifact.name)).toEqual(['capture.png'])
  })
})
