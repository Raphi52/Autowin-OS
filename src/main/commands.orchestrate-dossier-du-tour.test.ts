import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * UN RUN PART DANS LE DOSSIER DE SA CONVERSATION (2026-09-17).
 *
 * La correction du 2026-09-16 (`commands.dossier-du-tour.test.ts`) n'avait rebranche que les
 * COMMANDES du tour (`create_file`, `read_file`, `delete_file`, `verify`...). Le chemin
 * `orchestrate` etait reste sur l'ancien monde : `runTask` n'avait AUCUN parametre de dossier, donc
 * l'orchestrateur lisait `deps.executionWorkspace` -- la valeur figee au demarrage de l'app
 * (`os.ts`, `resolveExecutionWorkspace()`), impossible a changer sans redemarrer.
 *
 * MESURE QUI A FAIT ECRIRE CE TEST (conv-649) : une demande visant explicitement `D:/RigV3Desktop`
 * a produit un run qui a analyse `D:/AutoWinOS` et rendu un livrable hors sujet. 11,65 $ perdus,
 * et aucun signal a l'utilisateur.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une conversation rangee sur
 * le dossier B pendant que le dossier global vaut A. Rien dans l'appel `orchestrate` ne nomme de
 * dossier -- c'est donc le seul cas ou le rangement decide. Si le bus retombe sur le global, le
 * `workspace` recu par `runTask` vaut A et l'assertion tombe.
 */
function espace(prefixe: string): string {
  return resolve(mkdtempSync(join(tmpdir(), `autowin-${prefixe}-`)))
}

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

/** Index du dernier parametre de `runTask` (`runOptions`), signature positionnelle. */
const INDEX_RUN_OPTIONS = 17

function osQuiCaptureLeDossier(
  global: string,
  projectPath: string | undefined,
  vus: { workspace?: string }
): OsDouble {
  const conversation = {
    id: 'conv-1',
    title: 'fil',
    category: 'claude',
    provider: 'claude',
    messages: [],
    runPaths: [],
    createdAt: 1,
    updatedAt: 2,
    projectPath
  }
  return {
    executionWorkspace: global,
    conversations: {
      get: (id: string) => (id === 'conv-1' ? conversation : undefined),
      list: () => [conversation],
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
      const runOptions = args[INDEX_RUN_OPTIONS] as { workspace?: string } | undefined
      vus.workspace = runOptions?.workspace
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

describe('orchestrate — le run part dans le dossier range sur la conversation', () => {
  it('transmet le dossier de la conversation, pas le dossier global fige au demarrage', async () => {
    const global = espace('global')
    const projet = espace('projet')
    const vus: { workspace?: string } = {}
    const bus = new AppCommandBus(osQuiCaptureLeDossier(global, projet, vus), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1')

    expect(vus.workspace).toBe(projet)
    expect(vus.workspace).not.toBe(global)
  })

  it('conversation rangee sur un LIBELLE (categorie) → repli sur le dossier global', async () => {
    const global = espace('global')
    const vus: { workspace?: string } = {}
    const bus = new AppCommandBus(osQuiCaptureLeDossier(global, 'Fiches Team', vus), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1')

    expect(vus.workspace).toBe(global)
  })

  it('conversation NON rangee → repli sur le dossier global, comportement inchange', async () => {
    const global = espace('global')
    const vus: { workspace?: string } = {}
    const bus = new AppCommandBus(osQuiCaptureLeDossier(global, undefined, vus), () => {})

    await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1')

    expect(vus.workspace).toBe(global)
  })
})
