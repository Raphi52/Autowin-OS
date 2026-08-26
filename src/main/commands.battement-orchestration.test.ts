import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * LE SIGNE DE VIE PENDANT UNE ORCHESTRATION.
 *
 * MESURÉ le 2026-08-25 dans l'app réelle. Un tour a lancé une orchestration : le fil a affiché
 * « 1 action en cours · Orchestration » et RIEN d'autre pendant ONZE minutes, jusqu'au cap de
 * l'observateur. Le battement livré la veille ne couvrait que `verify` — le trou noir n'avait donc
 * pas disparu, il s'était déplacé d'un cran.
 *
 * LA NOTE D'ACTIVITÉ EXISTE DÉJÀ (« Bash en cours — 2 min 30 s ») : elle voyage sur
 * `orchestrate-delta`, dans son propre champ, et alimente la carte du panneau Workflows depuis le
 * correctif du 2026-08-22. Ce qui manquait n'est donc PAS une source — c'en fabriquer une seconde
 * aurait fait diverger deux vérités — mais son arrivée dans le FIL, là où l'utilisateur regarde.
 *
 * Ce test exige le câblage, pas la surface : la note passée par l'orchestrateur doit ressortir par
 * le `onProgress` de la commande, celui-là même qui devient le battement de l'action.
 */
/**
 * Le double d'OS, type par le CONTRAT qu'il honore au lieu d'un `any`.
 *
 * Meme motif que `commands.travaux-non-publies-dans-get-state.test.ts` (commit 24fd1498) : le type
 * se DEDUIT du constructeur -- il suit ses evolutions au lieu de mentir des la premiere -- et le
 * cast final assume que le double n'implemente que ce que CE test traverse.
 */
type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

function osQuiEmetUneNote(note: string): OsDouble {
  // Meme forme que le double des tests voisins : un double plus pauvre que le contrat teste une
  // fiction — `orchestrate` consulte `conversations`, `roles` et `budget` avant d'atteindre le run.
  const conversations = new Map<string, unknown>([
    [
      'conv-1',
      {
        id: 'conv-1',
        title: 'A garder',
        category: 'claude',
        provider: 'claude',
        messages: [],
        runPaths: [],
        createdAt: 1,
        updatedAt: 2
      }
    ]
  ])
  return {
    executionWorkspace: process.cwd(),
    conversations: {
      get: (id: string) => conversations.get(id),
      list: () => [...conversations.values()],
      attachRun: () => ({ id: 'conv-1', runPaths: [] })
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    listBrains: () => [],
    loadBrainGraph: () => ({ nodes: [], links: [] }),
    chat: async () => ({ text: '', provider: 'claude', systemInjected: false }),
    runTask: async (...args: unknown[]) => {
      // Signature POSITIONNELLE de `runTask`, telle que les tests voisins la lisent deja
      // (`args[1]` = onStep, `args[2]` = onPhase, `args[11]` = onLifecycle).
      const onNote = args[3] as (step: string, delta: string, note?: string) => void
      onNote('exec', '', note)
      return {
        task: String(args[0] ?? ''),
        gateBlocked: false,
        gateReasons: [],
        valid: true,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }
  } as unknown as OsDouble
}

describe('orchestrate — la note d’activité devient le battement de l’action', () => {
  it('relaie la note vers onProgress, sans en inventer une seconde', async () => {
    const vus: string[] = []
    const bus = new AppCommandBus(osQuiEmetUneNote('Bash en cours — 2 min 30 s'), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1', undefined, undefined, (t) =>
      vus.push(t)
    )

    expect(vus).toContain('Bash en cours — 2 min 30 s')
  })

  it('borne la note comme toute ligne de vie : ni codes couleur, ni débordement', async () => {
    const vus: string[] = []
    const sale = `\u001b[33m${'x'.repeat(300)}\u001b[39m`
    const bus = new AppCommandBus(osQuiEmetUneNote(sale), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1', undefined, undefined, (t) =>
      vus.push(t)
    )

    expect(vus).toHaveLength(1)
    // eslint-disable-next-line no-control-regex
    expect(vus[0]).not.toMatch(/\u001b/)
    expect(vus[0].length).toBeLessThanOrEqual(140)
  })

  it('une orchestration SANS note ne fabrique aucun battement creux', async () => {
    const vus: string[] = []
    const bus = new AppCommandBus(osQuiEmetUneNote(''), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1', undefined, undefined, (t) =>
      vus.push(t)
    )

    expect(vus).toHaveLength(0)
  })
})
