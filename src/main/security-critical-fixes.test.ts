import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTokens, saveTokens, type Tokens } from './providers/codex-auth'

const dir = mkdtempSync(join(tmpdir(), 'secfix-'))
const authPath = join(dir, 'auth.json')
afterEach(() => {
  try {
    rmSync(authPath)
  } catch {
    /* absent */
  }
})

describe('critique #1 — persistance auth.json durcie', () => {
  const tok: Tokens = { accessToken: 'a', refreshToken: 'r', obtainedAt: 1, expiresInSec: 3600 }

  it('save→load round-trip (hors electron : repli clair 0o600)', () => {
    saveTokens(tok, authPath)
    expect(loadTokens(authPath)).toEqual(tok)
  })

  it('migre un ancien fichier EN CLAIR (legacy) au chargement', () => {
    writeFileSync(authPath, JSON.stringify(tok, null, 2), 'utf8')
    expect(loadTokens(authPath)).toEqual(tok) // lu + re-sauvé (migration best-effort)
  })

  it('fichier absent → null', () => {
    expect(loadTokens(join(dir, 'nope.json'))).toBeNull()
  })
})

describe('critique #2 — handlers IPC agentiques gardés', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const guarded = (channel: string): boolean => {
    // le channel peut être sur la même ligne que ipcMain.handle OU la ligne suivante (pilotChat)
    const start = source.indexOf(`'${channel}'`)
    if (start < 0) return false
    const block = source.slice(start, start + 1200)
    return /assertTrustedRendererSender\(\s*event/.test(block)
  }
  it.each([
    // critiques
    'os:orchestrate',
    'os:pilotChat',
    'os:pilot',
    'os:kimiLogin',
    // hautes/moyennes (audit #3) : config + lectures fichier + brain
    'os:setRole',
    'os:topology:set',
    'os:profiles:apply',
    'os:profiles:save',
    'os:conversations:remove',
    'os:runTrace',
    'os:activity:image',
    'os:loadBrainGraph',
    'os:readNodeFile'
  ])('%s appelle assertTrustedRendererSender', (channel) => {
    expect(guarded(channel)).toBe(true)
  })
})

describe('haute — loadBrainGraph confine la lecture fichier (audit #3)', () => {
  it('un fichier graphe hors racine légitime est REFUSÉ', async () => {
    const { loadBrainGraph } = await import('./viz/fs-brains')
    const outside = join(mkdtempSync(join(tmpdir(), 'evil-')), 'graph.json')
    writeFileSync(outside, JSON.stringify({ nodes: [{ id: 'x' }], links: [] }), 'utf8')
    expect(() => loadBrainGraph(outside)).toThrow(/hors périmètre/)
    rmSync(outside)
  })
})
