import { describe, expect, it, vi } from 'vitest'
import type * as ChildProcess from 'node:child_process'

/*
 * LA PASSE DE RETENTION NE CREE PLUS AUCUN PROCESSUS SUR LE FIL PRINCIPAL (heal conv-1013).
 *
 * Mesure du 2026-10-16 : `gels.jsonl` porte 3 gels `spawn git cherry` de 3,7 a 8,8 s (14-16/10),
 * tous 25 a 31 s apres un demarrage — la passe de retention lancee au demarrage (index.ts,
 * `passeDeRetention`). Sur le vrai depot, une passe = 78 processus (1 `for-each-ref` + 77
 * `git cherry`), 12 s de git, 631 ms cumulees de CREATION de processus sur le fil appelant. Le
 * passage en `execFile` du 2026-09-08 avait retire l'attente du resultat, pas la creation : sous
 * Windows elle reste synchrone, et elle cale avec le systeme.
 *
 * Contrat verrouille : quand le worker existe, `recenserRetentionAsync` lui confie TOUT git et ne
 * cree aucun processus sur le fil appelant ; la regle (consigne comprise) rend le meme verdict
 * que la voie synchrone.
 */
const processus: string[] = []
vi.mock('node:child_process', async (original) => {
  const vrai = (await original()) as typeof ChildProcess
  const compter =
    <F extends (...args: never[]) => unknown>(nom: string, fn: F) =>
    (...args: Parameters<F>): ReturnType<F> => {
      processus.push(`${nom} ${String(args[0])} ${JSON.stringify(args[1] ?? '')}`)
      return fn(...args) as ReturnType<F>
    }
  return {
    ...vrai,
    execFile: compter('execFile', vrai.execFile as never),
    execFileSync: compter('execFileSync', vrai.execFileSync as never),
    spawn: compter('spawn', vrai.spawn as never),
    spawnSync: compter('spawnSync', vrai.spawnSync as never)
  }
})

const { WorktreeManager } = await import('./worktree-manager')

const REFS = [
  'refs/autowin/integration/aaa 1111111 1700000000',
  'refs/autowin/trie/bbb 2222222 1700000000',
  'refs/autowin/rescue/ccc 3333333 1700000000',
  'refs/heads/autowin/ddd 4444444 1700000000'
].join('\n')
/** Le git simule cote WORKER : `ccc` est deja en base, les autres apportent quelque chose. */
const gitSimule = (
  _repo: string,
  args: string[]
): { code: number; stdout: string; stderr: string } =>
  args[0] === 'cherry'
    ? { code: 0, stdout: args[2]!.includes('ccc') ? '- abc\n' : '+ abc\n', stderr: '' }
    : { code: 0, stdout: REFS, stderr: '' }

/** Un worker de test qui repond comme le vrai : un manager SANS client, cote worker. */
function fauxWorker() {
  const ecouteurs: Record<string, (valeur: never) => void> = {}
  const cote = new WorktreeManager({
    baseRepo: 'D:/depot',
    worktreeRoot: 'D:/depot/.worktrees',
    tryGitFn: gitSimule,
    disableAsyncOperations: true
  })
  return {
    on(evenement: string, ecouteur: (valeur: never) => void) {
      ecouteurs[evenement] = ecouteur
      return this
    },
    postMessage(requete: { operation: string }) {
      queueMicrotask(() => {
        try {
          if (requete.operation !== 'verdictsRetention') throw new Error(requete.operation)
          ecouteurs.message?.({ type: 'result', value: cote.verdictsRetention() } as never)
        } catch (erreur) {
          ecouteurs.message?.({ type: 'error', error: String(erreur) } as never)
        }
      })
    },
    terminate: async () => 0
  }
}

describe('passe de retention — hors du fil principal', () => {
  it('avec le worker : AUCUN processus cree sur le fil appelant', async () => {
    const fil = new WorktreeManager({
      baseRepo: 'D:/depot-inexistant',
      worktreeRoot: 'D:/depot-inexistant/.worktrees',
      operationWorkerFactory: fauxWorker as never
    })
    processus.length = 0

    const entrees = await fil.recenserRetentionAsync((sha) => sha === '4444444')

    expect(processus).toEqual([])
    expect(entrees.map((e) => [e.nom, e.apporteQuelqueChose, e.shaConsigne])).toEqual([
      ['refs/autowin/integration/aaa', true, false],
      ['refs/autowin/trie/bbb', false, false],
      ['refs/autowin/rescue/ccc', false, false],
      ['refs/heads/autowin/ddd', true, true]
    ])
  })

  it('rend le MEME verdict que la voie synchrone, consigne comprise', async () => {
    const consigne = (sha: string): boolean => sha === '1111111' || sha === '3333333'
    const synchrone = new WorktreeManager({
      baseRepo: 'D:/depot',
      worktreeRoot: 'D:/depot/.worktrees',
      tryGitFn: gitSimule
    }).recenserRetention(consigne)
    const parWorker = await new WorktreeManager({
      baseRepo: 'D:/depot-inexistant',
      worktreeRoot: 'D:/depot-inexistant/.worktrees',
      operationWorkerFactory: fauxWorker as never
    }).recenserRetentionAsync(consigne)

    const sansAge = (entrees: typeof synchrone): unknown =>
      entrees.map(({ ageMs: _ageMs, ...reste }) => reste)
    expect(sansAge(parWorker)).toEqual(sansAge(synchrone))
    expect(parWorker).toHaveLength(4)
  })
})
