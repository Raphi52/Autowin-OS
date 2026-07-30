import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stdoutJournalPath } from './stdout-journal'
import { spawnSurvivable } from './survivable-spawn'

/** Vrais processus : c'est la SURVIE qu'on veut prouver, pas notre idée de la survie. */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-survivable-'))
  dirs.push(dir)
  return dir
}

/** Un script qui écrit N lignes espacées — assez lent pour qu'on puisse tuer le parent au milieu. */
function slowWriter(dir: string, lines: number, delayMs: number): string {
  const path = join(dir, 'writer.mjs')
  writeFileSync(
    path,
    `let i = 0
const timer = setInterval(() => {
  i += 1
  process.stdout.write(JSON.stringify({ n: i }) + '\\n')
  if (i >= ${lines}) { clearInterval(timer) }
}, ${delayMs})
`
  )
  return path
}

describe('lancement survivable — la sortie n’est pas perdue avec l’app', () => {
  it('écrit dans un journal fichier plutôt que dans un pipe', async () => {
    const root = tempRoot()
    const writer = slowWriter(root, 3, 10)
    const run = spawnSurvivable({
      bin: process.execPath,
      args: [writer],
      journalRoot: root,
      runId: 'run-journal'
    })

    expect(run.survivable).toBe(true)
    expect(run.journalPath).toBeDefined()

    const lines: string[] = []
    await run.tail((line) => lines.push(line), {
      isComplete: () => run.child.exitCode !== null,
      pollMs: 20
    })
    run.release()

    expect(lines.length).toBe(3)
    // Le journal existe VRAIMENT sur disque : c'est lui qui rend la reprise possible.
    expect(readFileSync(run.journalPath!, 'utf8')).toContain('"n":3')
  })

  it('reprend la lecture depuis un offset — rien n’est rejoué deux fois', async () => {
    const root = tempRoot()
    const writer = slowWriter(root, 4, 10)
    const run = spawnSurvivable({ bin: process.execPath, args: [writer], journalRoot: root })

    const premier: string[] = []
    const { offset } = await run.tail((line) => premier.push(line), {
      isComplete: () => run.child.exitCode !== null,
      pollMs: 20
    })
    run.release()

    // Une instance ULTÉRIEURE repart de l'offset : elle ne revoit pas ce qui a déjà été affiché.
    const second: string[] = []
    await run.tail((line) => second.push(line), { from: offset, isComplete: () => true })
    expect(premier.length).toBe(4)
    expect(second).toEqual([])
  })

  it('LE CAS QUI COMPTE : le parent est TUÉ, l’enfant continue d’écrire', async () => {
    const root = tempRoot()
    const writer = slowWriter(root, 8, 150)

    // Un parent JETABLE, exécutant le VRAI code, lance l'enfant puis se fait tuer net. Sans
    // `detached` + journal, l'enfant partirait avec lui (ou écrirait dans un pipe mort) et le
    // journal resterait tronqué. C'est la seule mise en scène qui prouve la survie.
    const parentTs = join(root, 'parent.ts')
    writeFileSync(
      parentTs,
      `import { spawnSurvivable } from ${JSON.stringify(
        join(process.cwd(), 'src/main/runs/survivable-spawn').split('\\').join('/')
      )}
const run = spawnSurvivable({
  bin: process.argv[2],
  args: [process.argv[3]],
  journalRoot: process.argv[4],
  runId: 'run-orphelin'
})
run.release()
setInterval(() => {}, 1000) // reste vivant jusqu'a ce qu'on le tue
`
    )
    const parentJs = join(root, 'parent.mjs')
    execFileSync(
      'npx',
      ['esbuild', parentTs, '--bundle', '--platform=node', '--format=esm', `--outfile=${parentJs}`],
      { cwd: process.cwd(), shell: true, stdio: 'ignore' }
    )

    // Le chemin du journal est DETERMINISTE (racine + runId) : inutile de dependre de la sortie du
    // parent, qu'on va justement tuer.
    const path = stdoutJournalPath(root, 'run-orphelin')

    const parent = spawn(process.execPath, [parentJs, process.execPath, writer, root], {
      stdio: 'ignore'
    })

    /** Attente ASYNCHRONE : une boucle synchrone bloquerait l'event loop et ne verrait rien venir. */
    const waitUntil = async (predicate: () => boolean, limitMs: number): Promise<boolean> => {
      const deadline = Date.now() + limitMs
      while (Date.now() < deadline) {
        if (predicate()) return true
        await new Promise((resolve) => setTimeout(resolve, 100)) // sleep-ok: poll borne 100ms
      }
      return predicate()
    }
    const lu = (): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

    // L'enfant a demarre et produit ses premieres lignes.
    expect(await waitUntil(() => lu().includes('"n":1'), 40_000)).toBe(true)

    parent.kill('SIGKILL')
    expect(await waitUntil(() => parent.exitCode !== null || parent.signalCode !== null, 10_000)).toBe(true)
    const auMomentDuKill = lu()
    expect(auMomentDuKill).not.toContain('"n":8') // il restait du travail a faire

    // Parent mort. L'enfant doit AVOIR CONTINUE jusqu'au bout, dans le journal.
    expect(await waitUntil(() => lu().includes('"n":8'), 40_000)).toBe(true)
  })

  it('sans racine de journal : dégradation annoncée, jamais un lancement refusé', async () => {
    const root = tempRoot()
    const writer = slowWriter(root, 2, 10)
    const run = spawnSurvivable({
      bin: process.execPath,
      args: [writer],
      journalRoot: undefined,
      detachedEnabled: false
    })

    expect(run.survivable).toBe(false) // l'app peut le DIRE à l'utilisateur
    const lines: string[] = []
    await run.tail((line) => lines.push(line))
    expect(lines.length).toBe(2) // et la sortie reste lisible tant que l'app vit
  })
})
