import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRepoMap, repoMapBlock, REPO_MAP_MAX_BYTES } from './repo-map'

describe('repo-map — injection carte graphify', () => {
  let dir: string
  const graphDir = (): string => join(dir, 'graphify-out')
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repomap-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rend null / bloc vide quand aucun graphe (cas courant, dégradation gracieuse)', () => {
    expect(loadRepoMap(dir)).toBeNull()
    expect(repoMapBlock(dir)).toBe('')
  })

  it('charge GRAPH_REPORT.md sous graphify-out/ et étiquette le bloc', () => {
    mkdirSync(graphDir(), { recursive: true })
    writeFileSync(join(graphDir(), 'GRAPH_REPORT.md'), '# Carte\nhub: orchestrator.ts')
    const map = loadRepoMap(dir)
    expect(map?.file).toBe('GRAPH_REPORT.md')
    expect(map?.content).toContain('orchestrator.ts')
    const block = repoMapBlock(dir)
    expect(block).toContain('CARTE DU CODE')
    expect(block).toContain('orchestrator.ts')
  })

  it('joint la fraîcheur depuis SOURCE.md si présent', () => {
    mkdirSync(graphDir(), { recursive: true })
    writeFileSync(join(graphDir(), 'GRAPH_REPORT.md'), 'contenu')
    writeFileSync(join(graphDir(), 'SOURCE.md'), '# titre\ncommit 8e4daa9a — 2026-07-22')
    const map = loadRepoMap(dir)
    expect(map?.freshness).toContain('8e4daa9a')
    expect(repoMapBlock(dir)).toContain('8e4daa9a')
  })

  it('borne à REPO_MAP_MAX_BYTES (un résumé géant ne gonfle pas les tokens)', () => {
    mkdirSync(graphDir(), { recursive: true })
    const huge = 'x'.repeat(REPO_MAP_MAX_BYTES + 5000)
    writeFileSync(join(graphDir(), 'GRAPH_REPORT.md'), huge)
    const map = loadRepoMap(dir)
    expect(map).not.toBeNull()
    expect(map!.content).toContain('…[tronqué]')
    // borné : le contenu injecté ne dépasse pas le plafond + le marqueur
    expect(Buffer.byteLength(map!.content.replace('\n…[tronqué]', ''), 'utf8')).toBeLessThanOrEqual(
      REPO_MAP_MAX_BYTES
    )
  })

  it('ignore un GRAPH_REPORT.md vide (dégrade à null)', () => {
    mkdirSync(graphDir(), { recursive: true })
    writeFileSync(join(graphDir(), 'GRAPH_REPORT.md'), '   \n  ')
    expect(loadRepoMap(dir)).toBeNull()
  })
})
