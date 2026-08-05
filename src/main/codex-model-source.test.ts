import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { listCodexAppServerModels, type CodexAppServerModel } from './codex-model-source'

function fakeAppServer(
  pages: Record<string, { data: CodexAppServerModel[]; nextCursor?: string }>
) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    pid: 42,
    kill: vi.fn(() => true)
  })
  const requests: Array<Record<string, unknown>> = []
  let input = ''
  stdin.on('data', (chunk: Buffer) => {
    input += chunk.toString('utf8')
    const lines = input.split(/\r?\n/)
    input = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const request = JSON.parse(line) as {
        id?: number
        method: string
        params?: { cursor?: string }
      }
      requests.push(request)
      if (request.method === 'initialize') {
        stdout.write(`${JSON.stringify({ id: request.id, result: { userAgent: 'fixture' } })}\n`)
      }
      if (request.method === 'model/list') {
        const page = pages[request.params?.cursor ?? 'first']
        if (page) stdout.write(`${JSON.stringify({ id: request.id, result: page })}\n`)
      }
    }
  })
  return { child, requests }
}

describe('Codex app-server model source', () => {
  it('initializes the CLI, follows pagination and includes hidden account models', async () => {
    const fixture = fakeAppServer({
      first: {
        data: [
          {
            id: 'gpt-5.6-sol',
            model: 'gpt-5.6-sol',
            displayName: 'GPT-5.6-Sol',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
          }
        ],
        nextCursor: 'page-2'
      },
      'page-2': {
        data: [
          {
            id: 'codex-auto-review',
            model: 'codex-auto-review',
            displayName: 'Codex Auto Review',
            hidden: true,
            isDefault: false,
            defaultReasoningEffort: 'high',
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }]
          }
        ]
      }
    })

    const models = await listCodexAppServerModels({
      spawnFn: vi.fn(() => fixture.child as never),
      timeoutMs: 1_000
    })

    expect(models.map((model) => model.model)).toEqual(['gpt-5.6-sol', 'codex-auto-review'])
    expect(fixture.requests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'model/list',
      'model/list'
    ])
    expect(fixture.requests[2]).toMatchObject({
      params: { includeHidden: true, limit: 100, cursor: null }
    })
    expect(fixture.requests[3]).toMatchObject({
      params: { includeHidden: true, limit: 100, cursor: 'page-2' }
    })
    expect(fixture.child.kill).toHaveBeenCalled()
  })

  it('fails closed and terminates a silent app-server after the deadline', async () => {
    const fixture = fakeAppServer({})

    await expect(
      listCodexAppServerModels({
        spawnFn: vi.fn(() => fixture.child as never),
        timeoutMs: 10
      })
    ).rejects.toThrow(/silencieux/i)
    expect(fixture.child.kill).toHaveBeenCalled()
  })

  it('refuses to publish a partial catalog when the pagination safety bound is reached', async () => {
    const pages = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => {
        const cursor = index === 0 ? 'first' : `page-${index + 1}`
        return [
          cursor,
          {
            data: [],
            nextCursor: `page-${index + 2}`
          }
        ]
      })
    )
    const fixture = fakeAppServer(pages)

    await expect(
      listCodexAppServerModels({
        spawnFn: vi.fn(() => fixture.child as never),
        timeoutMs: 1_000
      })
    ).rejects.toThrow(/pagination/i)
    expect(fixture.requests.filter((request) => request.method === 'model/list')).toHaveLength(50)
  })

  it('rejects a cyclic pagination cursor instead of looping or publishing duplicates', async () => {
    const fixture = fakeAppServer({
      first: { data: [], nextCursor: 'first' }
    })

    await expect(
      listCodexAppServerModels({
        spawnFn: vi.fn(() => fixture.child as never),
        timeoutMs: 1_000
      })
    ).rejects.toThrow(/curseur/i)
    expect(fixture.requests.filter((request) => request.method === 'model/list')).toHaveLength(2)
  })
})

/**
 * LE WRAPPER `codex.js` OUVRE UNE CONSOLE VISIBLE — il faut viser le binaire natif.
 *
 * Mesuré le 2026-08-05 : ~14 s après le démarrage de l'app, une fenêtre Windows Terminal titrée
 * `…\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` apparaissait à côté de l'app. La
 * filiation relevée était `codex.exe ← electron.exe (exécutant codex.js) ← electron ← electron-vite`.
 *
 * Notre `spawn` pose bien `windowsHide: true`, mais il lance le WRAPPER npm, et c'est le wrapper qui
 * relance le binaire natif — sans ce drapeau. Le masquage ne se transmet pas à un petit-enfant.
 * `providers/codex.ts` résolvait déjà le binaire natif pour cette raison exacte ; ce chemin-ci, lui,
 * passait encore par le wrapper.
 */
describe('Codex app-server — aucune console visible sous Windows', () => {
  const tripleParArch: Record<string, { paquet: string; triple: string }> = {
    x64: { paquet: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' },
    arm64: { paquet: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
  }

  it('lance le binaire NATIF, pas le wrapper codex.js qui rouvre une console', async () => {
    const cible = tripleParArch[process.arch]
    if (!cible) return // architecture sans binaire natif publié : le wrapper reste le seul chemin

    const racine = mkdtempSync(join(tmpdir(), 'autowin-codex-native-'))
    const paquet = join(racine, 'npm', 'node_modules', '@openai', 'codex')
    mkdirSync(join(paquet, 'bin'), { recursive: true })
    writeFileSync(join(paquet, 'bin', 'codex.js'), '// wrapper npm')
    const natif = join(
      paquet,
      'node_modules',
      ...cible.paquet.split('/'),
      'vendor',
      cible.triple,
      'bin'
    )
    mkdirSync(natif, { recursive: true })
    writeFileSync(join(natif, 'codex.exe'), 'binaire natif')

    const fixture = fakeAppServer({ first: { data: [] } })
    let commande = ''
    let args: string[] = []
    try {
      await listCodexAppServerModels({
        platform: 'win32',
        appData: racine,
        timeoutMs: 1_000,
        spawnFn: (c, a) => {
          commande = c
          args = a
          return fixture.child as never
        }
      })
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }

    expect(commande).toBe(join(natif, 'codex.exe'))
    expect(args).toEqual(['app-server', '--stdio'])
    // Le discriminant : ni Electron-comme-node, ni le wrapper, ne doivent apparaître.
    expect(commande).not.toContain('electron')
    expect(args.join(' ')).not.toContain('codex.js')
  })
})
