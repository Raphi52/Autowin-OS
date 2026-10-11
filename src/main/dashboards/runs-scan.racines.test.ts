import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * LA LISTE DES RUNS VUE PAR L'AGENT LISAIT UN DOSSIER QU'AUTOWIN N'ÉCRIT PAS.
 *
 * Kaizen conv-253 (2026-10-11) : `runsWithGate()` → `scanRunsPourSnapshot()` → `runsRoot()` =
 * `C:\Users\User\.claude\runs`, absent du poste. Les runs lancés depuis une conversation vivent dans
 * `convRunsRoot()` (`.autowin-data/autowin-os/runs`). Sonde tsx du 2026-10-11 17:19 : 0 run vu par
 * défaut, 24 dans le vrai dossier dont 9 « open » — parmi eux la construction du lecteur vidéo de
 * conv-253 (relais 25940 vivant). Conséquences : le contexte collecté de ce kaizen disait
 * « Runs en cours/bloqués: aucun observé », `get_state` rendait `runs: []`, et les tours
 * dcb537d2-ed5a-4646-806d-880ef76df295 et bdfe38d3-5ba5-4693-bad2-f70b39bc845e ont payé
 * 1,03 M + 0,58 M de jetons d'entrée en sondes Bash pour savoir où en était la construction.
 */
const { readFileSpy } = vi.hoisted(() => ({ readFileSpy: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...reel,
    readFile: (...args: unknown[]) => {
      readFileSpy(args[0])
      return (reel.readFile as (...a: unknown[]) => Promise<string>)(...args)
    }
  }
})

const { scanRunsPourSnapshot, LIMITE_RUNS_SNAPSHOT } = await import('./runs-scan')

function racine(prefixe: string, combien: number, decalageMinutes: number, statut = 'red'): string {
  const root = mkdtempSync(join(tmpdir(), `runs-racines-${prefixe}-`))
  for (let i = 0; i < combien; i += 1) {
    const dir = join(root, 'conv-1', `${prefixe}-${String(i).padStart(3, '0')}-workspace`)
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'RUN.md')
    writeFileSync(p, `status: ${statut}\nsession: conv-1\n\n## Besoin\nx\n`, 'utf8')
    const t = new Date(Date.now() - (decalageMinutes + combien - i) * 60_000)
    utimesSync(p, t, t)
  }
  return root
}

describe('scan des runs du snapshot — plusieurs racines', () => {
  it('voit le run ouvert de la racine des conversations quand celle du kit n’existe pas', async () => {
    const absente = join(tmpdir(), 'runs-racine-qui-n-existe-pas-253')
    const conv = racine('relance-construction', 1, 0, 'open')
    const vus = await scanRunsPourSnapshot([absente, conv])
    expect(vus.map((r) => `${r.subject}:${r.summary.status}`)).toEqual([
      'relance-construction-000:open'
    ])
  })

  it('reste borné à N lectures au TOTAL, et garde les plus récents toutes racines confondues', async () => {
    const kit = racine('kit', 20, 0)
    const conv = racine('conv', 20, 30)
    readFileSpy.mockClear()
    const vus = await scanRunsPourSnapshot([conv, kit])
    const lus = readFileSpy.mock.calls.filter((c) => String(c[0]).endsWith('RUN.md'))
    expect(lus.length).toBe(LIMITE_RUNS_SNAPSHOT)
    expect(vus.length).toBe(LIMITE_RUNS_SNAPSHOT)
    // Les runs `kit` sont plus récents (décalage 0) : ils passent devant.
    expect(vus[0]?.subject).toBe('kit-019')
    expect(vus.horsFenetre).toBe(40 - LIMITE_RUNS_SNAPSHOT)
  })

  it('la même racine donnée deux fois n’est lue qu’une fois (AUTOWIN_RUN_ROOT = racine des conversations)', async () => {
    const conv = racine('double', 3, 0)
    const vus = await scanRunsPourSnapshot([conv, conv])
    expect(vus.map((r) => r.subject).sort()).toEqual(['double-000', 'double-001', 'double-002'])
  })
})
