import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEvidence, StreamChunk } from './types'

// fix-ok: le lecteur perdait le `cd` d'un test, et 30 `cd` sur 33 mesurés visent le dossier du tour :
// le dossier de l'appel doit donc atteindre le lecteur depuis l'adaptateur.
// Même harnais de spawn que claude.cible-entiere.test.ts : on rejoue une séquence stream-json.
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

const succes = {
  type: 'result',
  subtype: 'success',
  result: 'ok',
  session_id: 's',
  is_error: false,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
}

const bash = (command: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command, ...extra } }] }
})

const resultat = (isError: boolean, content: string): Record<string, unknown> => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: isError, content }] }
})

async function testsEmis(): Promise<NonNullable<StreamChunk['testsDuTerminal']>> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const tests: NonNullable<StreamChunk['testsDuTerminal']> = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.testsDuTerminal) tests.push(...step.value.testsDuTerminal)
    step = await gen.next()
  }
  return tests
}

/**
 * LE CODE DE SORTIE D'UN TEST LANCÉ PAR L'AGENT QUITTE L'ADAPTATEUR (2026-10-22).
 *
 * L'adaptateur tenait déjà la commande et l'issue de chaque `Bash` (`is_error`, « Exit code N »), et
 * n'en laissait sortir que deux lignes de texte (« Bash · npm test », « Bash terminé - 3 s ») : la
 * carte du fil ne pouvait donc rien prouver d'un test joué dans le terminal.
 */
describe('ClaudeCliAdapter — les tests du terminal et leur code de sortie', () => {
  it('un test réussi : code 0 ; un test rouge : le « Exit code N » du CLI', async () => {
    spawnCapture.stdoutEvents = [
      bash('npx vitest run src/a.test.ts'),
      resultat(false, ' Tests  3 passed (3)'),
      succes
    ]
    expect(await testsEmis()).toEqual([
      { commande: 'npx vitest run src/a.test.ts', codeDeSortie: 0 }
    ])

    spawnCapture.stdoutEvents = [
      bash('npm run typecheck'),
      resultat(true, 'Exit code 2\nsrc/a.ts(1,1): error TS2304'),
      succes
    ]
    expect(await testsEmis()).toEqual([{ commande: 'npm run typecheck', codeDeSortie: 2 }])
  })

  it('lit le code écrit par `echo EXIT=$?` dans la sortie', async () => {
    spawnCapture.stdoutEvents = [
      bash('npm run typecheck > /tmp/tc.log 2>&1; echo EXIT=$?'),
      resultat(false, 'EXIT=1'),
      succes
    ]
    expect(await testsEmis()).toEqual([{ commande: 'npm run typecheck', codeDeSortie: 1 }])
  })

  it('une commande lancée EN FOND rend la main tout de suite : son « succès » ne prouve rien', async () => {
    spawnCapture.stdoutEvents = [
      bash('npx vitest run', { run_in_background: true }),
      resultat(false, 'Command running in background with ID: b1'),
      succes
    ]
    expect(await testsEmis()).toEqual([])
  })

  it('le test émis et sa trace disent dans quel dossier il a tourné (conv-1423)', async () => {
    spawnCapture.stdoutEvents = [
      bash('cd ../autre && npm test'),
      resultat(false, ' Tests  3 passed (3)'),
      succes
    ]
    expect(await testsEmis()).toEqual([
      { commande: 'npm test', codeDeSortie: 0, changementDeDossier: 'cd ../autre' }
    ])

    spawnCapture.stdoutEvents = [
      bash('cd ../autre && npm test'),
      resultat(false, ' Tests  3 passed (3)'),
      succes
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(step.value.executionEvidence?.[0]?.testsLus).toEqual([
      {
        commande: 'npm test',
        codeDeSortie: 0,
        changementDeDossier: 'cd ../autre',
        at: expect.any(Number)
      }
    ])
  })

  it('un `cd` vers le dossier du tour n’en est pas un changement (conv-1423)', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'claude-tests-cd-'))
    try {
      spawnCapture.stdoutEvents = [
        bash(`cd "${dossier}" && npm test`),
        resultat(false, ' Tests  3 passed (3)'),
        succes
      ]
      const { ClaudeCliAdapter } = await import('./claude')
      const gen = new ClaudeCliAdapter({ bin: 'claude' }).send(
        [{ role: 'user', content: 'Salut' }],
        { execution: { cwd: dossier, sandbox: 'read-only' } }
      )
      const tests: NonNullable<StreamChunk['testsDuTerminal']> = []
      let step = await gen.next()
      while (!step.done) {
        if (step.value.testsDuTerminal) tests.push(...step.value.testsDuTerminal)
        step = await gen.next()
      }
      expect(tests).toEqual([{ commande: 'npm test', codeDeSortie: 0 }])
      expect(step.value.executionEvidence?.[0]?.testsLus).toEqual([
        { commande: 'npm test', codeDeSortie: 0, at: expect.any(Number) }
      ])
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })

  it('la trace de l’appel porte les tests lus et ceux qui ne comptent pas (conv-1423)', async () => {
    const trace = async (): Promise<ExecutionEvidence | undefined> => {
      const { ClaudeCliAdapter } = await import('./claude')
      const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
      let step = await gen.next()
      while (!step.done) step = await gen.next()
      return step.value.executionEvidence?.[0]
    }
    spawnCapture.stdoutEvents = [
      bash('npx vitest run src/a.test.ts'),
      resultat(true, 'Exit code 1\n Tests  1 failed (1)'),
      succes
    ]
    expect((await trace())?.testsLus).toEqual([
      { commande: 'npx vitest run src/a.test.ts', codeDeSortie: 1, at: expect.any(Number) }
    ])

    spawnCapture.stdoutEvents = [
      bash('npx vitest run', { run_in_background: true }),
      resultat(false, 'Command running in background with ID: b1'),
      succes
    ]
    const enFond = await trace()
    expect(enFond?.testsLus).toBeUndefined()
    expect(enFond?.testsNonComptes).toEqual(['npx vitest run'])

    spawnCapture.stdoutEvents = [
      bash('npm test | tail -5'),
      resultat(false, 'fin de sortie'),
      succes
    ]
    const tube = await trace()
    expect(tube?.testsLus).toBeUndefined()
    expect(tube?.testsNonComptes).toEqual(['npm test'])
  })

  it('un test passé à `| tail` ne prouve rien (le code est celui de `tail`)', async () => {
    spawnCapture.stdoutEvents = [
      bash('npx vitest run 2>&1 | tail -5'),
      resultat(false, ' Tests  1 failed (1)'),
      succes
    ]
    expect(await testsEmis()).toEqual([])
  })
})
