import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stdoutJournalPath } from './stdout-journal'
import { spawnSurvivable, usesWindowsSurvivalRelay } from './survivable-spawn'

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

async function waitUntil(predicate: () => boolean, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
}

describe('lancement survivable — la sortie n’est pas perdue avec l’app', () => {
  it('isole les runs Windows dans le relais sans console', () => {
    expect(usesWindowsSurvivalRelay('win32')).toBe(true)
    expect(usesWindowsSurvivalRelay('linux')).toBe(false)
  })

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
    const started = await waitUntil(() => lu().includes('"n":1'), 40_000)
    expect(started, lu()).toBe(true)

    parent.kill('SIGKILL')
    expect(
      await waitUntil(() => parent.exitCode !== null || parent.signalCode !== null, 10_000)
    ).toBe(true)
    const auMomentDuKill = lu()
    expect(auMomentDuKill).not.toContain('"n":8') // il restait du travail a faire

    // Parent mort. L'enfant doit AVOIR CONTINUE jusqu'au bout, dans le journal.
    expect(await waitUntil(() => lu().includes('"n":8'), 40_000)).toBe(true)
  })

  it('tuer le relais arrête son CLI et efface le prompt matérialisé', async () => {
    if (process.platform !== 'win32') return
    const root = tempRoot()
    const writer = slowWriter(root, 30, 100)
    const run = spawnSurvivable({
      bin: process.execPath,
      args: [writer],
      journalRoot: root,
      runId: 'run-annule',
      stdin: 'prompt sensible'
    })
    const read = (): string => readFileSync(run.journalPath!, 'utf8')
    expect(await waitUntil(() => read().includes('"n":1'), 10_000)).toBe(true)
    expect(readdirSync(root).some((name) => name.endsWith('.stdin'))).toBe(true)
    run.child.kill('SIGKILL')
    expect(
      await waitUntil(() => run.child.exitCode !== null || run.child.signalCode !== null, 5_000)
    ).toBe(true)
    expect(
      await waitUntil(() => !readdirSync(root).some((name) => name.endsWith('.stdin')), 5_000)
    ).toBe(true)
    const journalAtStop = read()
    // Le writer met 3 s à finir. Attendre au-delà rend la preuve falsifiable : si le Job Object ne
    // tuait pas le vrai CLI, le journal aurait nécessairement continué à grossir jusqu'à n=30.
    await new Promise((resolve) => setTimeout(resolve, 3_500))
    expect(read()).toBe(journalAtStop)
    run.release()
  })

  it('garde invisible un descendant console lancé par un CLI Kimi/Gemini-like', async () => {
    if (process.platform !== 'win32') return
    const root = tempRoot()
    const marker = `AUTOWIN_AGENT_CLI_HIDDEN_${Date.now()}`
    const readyPath = join(root, 'monitor.ready')
    const observedPath = join(root, 'observed.json')
    const monitorPath = join(root, 'monitor.ps1')
    const fixturePath = join(root, 'kimi-like.cjs')

    writeFileSync(
      monitorPath,
      String.raw`param([string]$Marker, [string]$ReadyPath, [string]$ObservedPath)
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AutowinVisibleWindowProbe {
  delegate bool EnumWindowsProc(IntPtr handle, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder title, int max);
  public static string[] Find(string marker) {
    var found = new List<string>();
    EnumWindows((handle, state) => {
      if (!IsWindowVisible(handle)) return true;
      var title = new StringBuilder(512);
      GetWindowText(handle, title, title.Capacity);
      if (title.ToString().IndexOf(marker, StringComparison.Ordinal) >= 0) found.Add(title.ToString());
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
Add-Type -TypeDefinition $source
[System.IO.File]::WriteAllText($ReadyPath, 'ready')
$hits = @()
$deadline = (Get-Date).AddSeconds(4)
while ((Get-Date) -lt $deadline) {
  $hits += [AutowinVisibleWindowProbe]::Find($Marker)
  Start-Sleep -Milliseconds 20
}
$json = ConvertTo-Json -InputObject @($hits | Sort-Object -Unique) -Compress
[System.IO.File]::WriteAllText($ObservedPath, $json)
`
    )
    writeFileSync(
      fixturePath,
      `const { spawn } = require('node:child_process')
const command = ${JSON.stringify(`try { $Host.UI.RawUI.WindowTitle = '${marker}' } catch {}; Start-Sleep -Milliseconds 1500`)}
const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
  shell: false,
  windowsHide: false,
  stdio: 'ignore'
})
child.once('error', (error) => { console.error(error); process.exit(1) })
child.once('close', (code) => {
  process.stdout.write(JSON.stringify({ probe: 'done', code }) + '\\n')
  process.exit(code == null ? 1 : code)
})
`
    )

    const monitor = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        monitorPath,
        '-Marker',
        marker,
        '-ReadyPath',
        readyPath,
        '-ObservedPath',
        observedPath
      ],
      { shell: false, windowsHide: true, stdio: 'ignore' }
    )
    expect(await waitUntil(() => existsSync(readyPath), 10_000)).toBe(true)

    const run = spawnSurvivable({
      bin: process.execPath,
      args: [fixturePath],
      journalRoot: root,
      runId: 'run-kimi-like'
    })
    const lines: string[] = []
    await run.tail((line) => lines.push(line), {
      isComplete: () => run.child.exitCode !== null,
      pollMs: 20
    })
    run.release()
    expect(await waitForClose(monitor)).toBe(0)

    expect(lines.some((line) => line.includes('"probe":"done"'))).toBe(true)
    expect(JSON.parse(readFileSync(observedPath, 'utf8'))).toEqual([])
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

/**
 * UN JOURNAL VIDE EST INDISCERNABLE D'UN SOUS-AGENT BLOQUÉ.
 *
 * Le journal est ouvert AVANT le spawn (il faut son descripteur pour les stdio de l'enfant). Quand le
 * CLI n'écrit finalement rien — sortie immédiate, lancement en échec, signal déjà annulé — le fichier
 * reste à 0 octet et rien ne le supprime.
 *
 * Mesuré le 2026-08-06 sur l'état réel : **18 journaux vides sur 242 (7,4 %)**, dont les UUID
 * n'apparaissaient dans AUCUNE trace (`activity`, `causal-trace`, `run-state`,
 * `prompt-observability`). Le coût n'est pas le disque, ce sont des fichiers minuscules : c'est
 * l'observabilité. Un 0 octet ressemble trait pour trait à un agent figé — ce défaut a fait partir son
 * propre diagnostic sur une fausse piste pendant dix minutes.
 */
describe('journal de run — pas de trace vide laissée derrière', () => {
  it('un CLI qui sort sans rien écrire ne laisse AUCUN journal vide', async () => {
    const root = tempRoot()
    const muet = join(root, 'muet.mjs')
    writeFileSync(muet, 'process.exit(0)\n')

    const run = spawnSurvivable({
      bin: process.execPath,
      args: [muet],
      journalRoot: root,
      runId: 'run-muet'
    })
    const chemin = run.journalPath!
    expect(chemin).toBeDefined()

    await new Promise<void>((resolve) => run.child.once('close', () => resolve()))
    run.release()

    // Laisser au nettoyage le temps de suivre la fermeture, sans dormir en aveugle.
    await waitUntil(() => !existsSync(chemin), 10_000)
    expect(existsSync(chemin)).toBe(false)
  })

  it('un journal qui a REÇU des lignes est conservé — discriminant', async () => {
    const root = tempRoot()
    const writer = slowWriter(root, 2, 10)

    const run = spawnSurvivable({
      bin: process.execPath,
      args: [writer],
      journalRoot: root,
      runId: 'run-bavard'
    })
    const chemin = run.journalPath!

    const lignes: string[] = []
    await run.tail((l) => lignes.push(l), {
      isComplete: () => run.child.exitCode !== null,
      pollMs: 20
    })
    run.release()

    // Si ce test devient rouge, le nettoyage détruit la reprise : c'est ce fichier qui la porte.
    expect(lignes.length).toBe(2)
    expect(existsSync(chemin)).toBe(true)
    expect(readFileSync(chemin, 'utf8')).toContain('"n":2')
  })

  it('un binaire introuvable GARDE son journal : il porte la raison de son échec', async () => {
    const root = tempRoot()
    const run = spawnSurvivable({
      bin: join(root, 'binaire-qui-nexiste-pas.exe'),
      args: [],
      journalRoot: root,
      runId: 'run-introuvable'
    })
    const chemin = run.journalPath!

    await waitUntil(() => run.child.exitCode !== null, 10_000)
    run.release()

    // Le nettoyage n'efface QUE le vide. Ici le relais a écrit pourquoi il a échoué : cette trace est
    // la seule explication disponible du run manqué, et un nettoyage trop large la détruirait.
    // (Assertion d'abord écrite à l'envers : je réclamais la suppression, le code avait raison.)
    expect(existsSync(chemin)).toBe(true)
    expect(readFileSync(chemin, 'utf8').length).toBeGreaterThan(0)
  })
})
