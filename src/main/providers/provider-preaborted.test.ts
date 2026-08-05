import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawns = vi.hoisted(() => ({ direct: 0, survivable: 0 }))
const workspaceCapture = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    spawns.direct += 1
    throw new Error('spawn direct interdit par le test')
  }
}))

vi.mock('../runs/survivable-spawn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs/survivable-spawn')>()),
  spawnSurvivable: () => {
    spawns.survivable += 1
    throw new Error('spawn survivable interdit par le test')
  }
}))

vi.mock('./workspace-mutation-evidence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workspace-mutation-evidence')>()),
  captureWorkspaceMutationSnapshot: workspaceCapture.capture
}))

import { ClaudeCliAdapter } from './claude'
import { CodexAdapter } from './codex'
import { KimiCliAdapter } from './kimi'

const previousCodexBin = process.env.CODEX_BIN
/** Restaurations à jouer après chaque test (variables d'environnement, dossiers privés). */
const nettoyages: Array<() => void> = []
afterEach(() => {
  for (const nettoyer of nettoyages.splice(0)) nettoyer()
  spawns.direct = 0
  spawns.survivable = 0
  workspaceCapture.capture.mockReset()
  if (previousCodexBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = previousCodexBin
})

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

function emptySnapshot() {
  return Object.assign(new Map<string, string>(), { generationMarkers: new Map<string, string>() })
}

function deferredSnapshot(): {
  promise: Promise<ReturnType<typeof emptySnapshot>>
  resolve: () => void
} {
  let resolvePromise!: (value: ReturnType<typeof emptySnapshot>) => void
  const promise = new Promise<ReturnType<typeof emptySnapshot>>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: () => resolvePromise(emptySnapshot()) }
}

describe('providers CLI — annulation avant lancement', () => {
  it('Claude refuse avant tout spawn', async () => {
    const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
      [{ role: 'user', content: 'travaille' }],
      { signal: abortedSignal() }
    )

    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawns).toEqual({ direct: 0, survivable: 0 })
  })

  it('Codex refuse avant tout spawn', async () => {
    process.env.CODEX_BIN = 'codex-test'
    const stream = new CodexAdapter().send([{ role: 'user', content: 'travaille' }], {
      signal: abortedSignal(),
      execution: { cwd: process.cwd(), sandbox: 'workspace-write' }
    })

    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawns).toEqual({ direct: 0, survivable: 0 })
  })

  it('Kimi refuse avant tout spawn', async () => {
    const stream = new KimiCliAdapter({ bin: 'kimi-test' }).send(
      [{ role: 'user', content: 'travaille' }],
      { signal: abortedSignal() }
    )

    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawns).toEqual({ direct: 0, survivable: 0 })
  })

  it('Claude refuse sans spawn si le signal est annulé pendant la capture et nettoie la pièce jointe', async () => {
    // FENÊTRE D'OBSERVATION PRIVÉE. Ce test comptait les dossiers `autowin-os-attachments-*` du
    // dossier temporaire SYSTÈME et en exigeait exactement un — il postulait donc l'exclusivité sur
    // une ressource partagée. Tout voisin matérialisant une pièce jointe en parallèle le faisait
    // échouer, et l'ajout d'un fichier de test sans lien suffisait à changer l'ordonnancement de
    // vitest pour provoquer ce chevauchement (constaté le 2026-08-05 : vert seul, rouge en suite).
    // `os.tmpdir()` lit TEMP/TMP : les rediriger ici rend le compte insensible aux voisins.
    const tmpSysteme = tmpdir()
    const tmpPrive = mkdtempSync(join(tmpSysteme, 'preaborted-'))
    const anciennesVars = { TEMP: process.env.TEMP, TMP: process.env.TMP }
    process.env.TEMP = tmpPrive
    process.env.TMP = tmpPrive
    nettoyages.push(() => {
      process.env.TEMP = anciennesVars.TEMP
      process.env.TMP = anciennesVars.TMP
      rmSync(tmpPrive, { recursive: true, force: true })
    })
    const before = new Set(readdirSync(tmpdir()))
    const deferred = deferredSnapshot()
    workspaceCapture.capture.mockReturnValueOnce(deferred.promise)
    const controller = new AbortController()
    const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
      [
        {
          role: 'user',
          content: 'travaille',
          attachments: [
            { name: 'preuve.txt', mimeType: 'text/plain', size: 5, kind: 'text', content: 'preuve' }
          ]
        }
      ],
      {
        signal: controller.signal,
        execution: { cwd: process.cwd(), sandbox: 'workspace-write', causallyIsolated: true }
      }
    )

    const pending = stream.next()
    await vi.waitFor(() => expect(workspaceCapture.capture).toHaveBeenCalledOnce())
    const materializedDirs = readdirSync(tmpdir())
      .filter((name) => name.startsWith('autowin-os-attachments-') && !before.has(name))
      .map((name) => `${tmpdir()}\\${name}`)
    expect(materializedDirs).toHaveLength(1)

    controller.abort()
    deferred.resolve()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawns).toEqual({ direct: 0, survivable: 0 })
    expect(materializedDirs.every((path) => !existsSync(path))).toBe(true)
  })

  it('Codex refuse sans spawn si le signal est annulé pendant la capture', async () => {
    process.env.CODEX_BIN = 'codex-test'
    const deferred = deferredSnapshot()
    workspaceCapture.capture.mockReturnValueOnce(deferred.promise)
    const controller = new AbortController()
    const stream = new CodexAdapter().send([{ role: 'user', content: 'travaille' }], {
      signal: controller.signal,
      execution: {
        cwd: process.cwd(),
        sandbox: 'workspace-write',
        causallyIsolated: true
      }
    })

    const pending = stream.next()
    await vi.waitFor(() => expect(workspaceCapture.capture).toHaveBeenCalledOnce())
    controller.abort()
    deferred.resolve()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawns).toEqual({ direct: 0, survivable: 0 })
  })
})
