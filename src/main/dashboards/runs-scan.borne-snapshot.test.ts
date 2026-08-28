import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * LE DÉFAUT, mesuré le 2026-08-28 par l'onglet Latence (journal `turn-timing.jsonl`, 1 290 tours) :
 * segment `snapshot` p50 229 ms, p95 1 288 ms, MAX 19 250 ms — payé à CHAQUE tour de chat, avant
 * même que le provider soit appelé.
 *
 * Cause : `snapshot()` appelle `os.runsWithGate()` → `listRuns()` → `scanRuns()` SANS borne. Le
 * scan `stat` tous les RUN.md de la racine puis en `readFile` la totalité — alors que le snapshot
 * n'en garde que 12 (`runs.slice(0, 12)`). Le commentaire de `scanRunsBounded` documente déjà le
 * prix : ~15 s sur 11 784 RUN.md.
 *
 * Ce test verrouille le CHEMIN et la LECTURE, pas un chrono (instable) : le chemin chaud ne doit
 * lire que les N plus récents.
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

function racineAvecRuns(combien: number): string {
  const root = mkdtempSync(join(tmpdir(), 'runs-borne-'))
  for (let i = 0; i < combien; i += 1) {
    const dir = join(root, 'conv-1', `sujet-${String(i).padStart(3, '0')}-workspace`)
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'RUN.md')
    writeFileSync(p, `# RUN sujet-${i}\n\n- statut: green\n`, 'utf8')
    // mtime croissant : le sujet 199 est le plus récent.
    const t = new Date(Date.now() - (combien - i) * 60_000)
    utimesSync(p, t, t)
  }
  return root
}

describe('scan des runs sur le CHEMIN CHAUD (snapshot de tour)', () => {
  it('ne lit QUE les N plus récents — 200 RUN.md sur disque, N lectures', async () => {
    // Entrée qui ferait échouer une fausse correction (lire tout puis `slice`) : 200 RUN.md.
    const root = racineAvecRuns(200)
    readFileSpy.mockClear()
    const entrees = await scanRunsPourSnapshot(root)
    const lus = readFileSpy.mock.calls.filter((c) => String(c[0]).endsWith('RUN.md'))
    expect(LIMITE_RUNS_SNAPSHOT).toBeLessThan(200)
    expect(lus.length).toBe(LIMITE_RUNS_SNAPSHOT)
    expect(entrees.length).toBe(LIMITE_RUNS_SNAPSHOT)
    // Et ce sont bien les PLUS RÉCENTS : le snapshot n'affiche que les 12 premiers.
    expect(entrees[0]?.subject).toBe('sujet-199')
  })

  it('la borne couvre largement les 12 runs que le snapshot garde', () => {
    expect(LIMITE_RUNS_SNAPSHOT).toBeGreaterThanOrEqual(12)
  })
})
