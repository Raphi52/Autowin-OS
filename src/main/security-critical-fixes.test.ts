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
    const marker = `'${channel}'`
    const start = source.indexOf(marker)
    if (start < 0) return false
    const next = source.indexOf('ipcMain.handle(', start + marker.length)
    const block = source.slice(start, next < 0 ? source.length : next)
    return /assertTrustedRendererSender\(\s*event/.test(block)
  }
  it.each([
    // critiques
    'os:orchestrate',
    'os:pilotChat',
    'os:kimiLogin',
    // hautes/moyennes (audit #3) : config + lectures fichier + brain
    'os:setRole',
    'os:topology:set',
    'os:profiles:apply',
    'os:profiles:save',
    'os:conversations:remove',
    'os:conversations:rename',
    'os:openFolder',
    'os:appCommand',
    'os:pilotChat:cancel',
    'os:orchestrate:cancel',
    'os:pilotChat:inject',
    'os:setActiveConversation',
    'os:causalTrace:displayed',
    'os:promptCalls',
    'os:causalTrace',
    'os:brainTraces',
    'os:runTrace',
    'os:loadBrainGraph',
    'os:readNodeFile',
    'app:storage-migration'
  ])('%s appelle assertTrustedRendererSender', (channel) => {
    expect(guarded(channel)).toBe(true)
  })

  it('couvre exhaustivement tous les ipcMain.handle exposes au renderer', () => {
    const handlers = [...source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)]
    const unguarded = handlers.flatMap((match, index) => {
      const block = source.slice(match.index, handlers[index + 1]?.index ?? source.length)
      const channel = match[1]
      const genericGuard =
        /assertTrusted(?:Renderer|Behaviour)Sender\(\s*event/.test(block) ||
        /createStorageMigrationReadHandler/.test(block)
      const specializedGuard =
        (channel === 'app:storage-migration-complete' &&
          /isTrustedRendererUrl\(event\.senderFrame/.test(block)) ||
        (channel === 'model:question:answer' &&
          /questionWindows\.get\(event\.sender\.id\)/.test(block))
      return genericGuard || specializedGuard ? [] : [channel]
    })

    // 132 depuis le 2026-08-10 : `os:listInbox`, `os:promoteInbox` et `os:rejectInbox` (boîte de
    // réception du savoir dans la vue Knowledge). Les trois passent par `assertTrustedRendererSender`,
    // donc `unguarded` reste vide — c'est cette seconde assertion qui porte la garantie de sécurité,
    // le compte n'étant là que pour forcer une relecture à chaque nouveau canal.
    expect(handlers).toHaveLength(132)
    expect(unguarded).toEqual([])
  })

  it('exige un conversationId avant toute lecture Brain', () => {
    const start = source.indexOf("'os:brainTraces'")
    const next = source.indexOf('ipcMain.handle(', start + 1)
    const block = source.slice(start, next)
    expect(block).toMatch(/guardString\(rawConversationId, 'conversationId'\)/)
    expect(block).not.toMatch(/readBrainTraces\([^)]*undefined/)
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
