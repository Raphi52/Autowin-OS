import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutowinOS } from './os'
import { CoordinateursParDepot } from '../store/coordinateurs-par-depot'

/*
 * LE DÉPÔT D'UN RUN : sa copie, son décomposeur et la publication d'un run vert suivent le dossier du
 * fil, et non le dossier principal. Un fil rangé sur un autre dépôt lisait le sien, puis recevait une
 * copie du principal et publiait dans le principal. Les trois fabriques sont espionnées : on lit à
 * l'arrivée où elles ont pointé.
 */
const espions = vi.hoisted(() => ({
  orchestrateurs: [] as Array<{ deps: Record<string, unknown> }>,
  decomposeurs: [] as string[],
  bases: [] as string[],
  publications: [] as string[]
}))

vi.mock('../orchestration/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../orchestration/orchestrator')>()),
  Orchestrator: class {
    constructor(readonly deps: Record<string, unknown>) {
      espions.orchestrateurs.push({ deps })
    }
  }
}))

vi.mock('../orchestration/greedy-decompose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../orchestration/greedy-decompose')>()),
  buildOrchestratorDecomposer: (options: { cwd: string }) => {
    espions.decomposeurs.push(options.cwd)
    return () => Promise.resolve([])
  }
}))

vi.mock('../runs/run-autoclose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs/run-autoclose')>()),
  captureCloseBaseline: (depot: string) => {
    espions.bases.push(depot)
    return Promise.resolve({ depot })
  },
  closeGreenRunOnDisk: (entree: { projectRepo: string }) => {
    espions.publications.push(entree.projectRepo)
    return Promise.resolve({ project: 'publie' })
  }
}))

type Coordinateur = { nom: string }
type Fermeture = {
  begin: (runId: string) => void
  close: (entree: { runId: string; task: string }) => Promise<unknown>
}
type OsDeTest = {
  orchestrateurPour(workflow: undefined, task: string, workspace?: string): unknown
}

describe('le dépôt d’un run : copie, décomposition et publication', () => {
  let racine: string
  let principal: string
  let autre: string
  let horsDepot: string
  let coordPrincipal: Coordinateur
  let coordAutre: Coordinateur

  beforeEach(() => {
    espions.orchestrateurs.length = 0
    espions.decomposeurs.length = 0
    espions.bases.length = 0
    espions.publications.length = 0
    racine = mkdtempSync(join(tmpdir(), 'depot-du-run-'))
    principal = join(racine, 'principal')
    autre = join(racine, 'autre')
    horsDepot = join(racine, 'documents')
    for (const depot of [principal, autre]) mkdirSync(join(depot, '.git'), { recursive: true })
    mkdirSync(horsDepot)
    coordPrincipal = { nom: 'principal' }
    coordAutre = { nom: 'autre' }
  })

  /** Une OS sans son constructeur : seuls les champs lus par la fabrique du run et ses trois morceaux. */
  function osSansConstructeur(): OsDeTest {
    const instance = Object.create(AutowinOS.prototype) as Record<string, unknown>
    Object.assign(instance, {
      executionWorkspace: principal,
      worktrees: coordPrincipal,
      copiesParDepot: new CoordinateursParDepot<Coordinateur>(
        { depot: principal, coordinateur: () => coordPrincipal },
        (depot) => (depot === autre ? coordAutre : undefined)
      ),
      orchestratorDeps: {},
      registry: {},
      roles: {},
      autoClose: true,
      closeBaselines: new Map(),
      lastAutoClose: undefined
    })
    return instance as unknown as OsDeTest
  }

  function dernierRun(): Record<string, unknown> {
    return espions.orchestrateurs[espions.orchestrateurs.length - 1].deps
  }

  it('un run lancé depuis un fil rangé sur un autre dépôt copie, décompose et publie dans CE dépôt', async () => {
    osSansConstructeur().orchestrateurPour(undefined, '', autre)
    const deps = dernierRun()

    expect(deps.executionWorkspace).toBe(autre)
    expect(deps.worktrees).toBe(coordAutre)
    expect(espions.decomposeurs).toEqual([autre])

    const fermeture = deps.closeGreenRun as Fermeture
    fermeture.begin('run-1')
    await fermeture.close({ runId: 'run-1', task: 'tâche' })
    expect(espions.bases).toEqual([autre])
    expect(espions.publications).toEqual([autre])
  })

  it('sans fil rangé, ou rangé sur le dossier principal, le run reste sur le dossier principal', async () => {
    osSansConstructeur().orchestrateurPour(undefined, '', undefined)
    const deps = dernierRun()

    expect(deps.executionWorkspace).toBe(principal)
    expect(deps.worktrees).toBe(coordPrincipal)
    expect(espions.decomposeurs).toEqual([principal])

    const fermeture = deps.closeGreenRun as Fermeture
    fermeture.begin('run-2')
    await fermeture.close({ runId: 'run-2', task: 'tâche' })
    expect(espions.publications).toEqual([principal])
  })

  it('un fil rangé hors de tout dépôt n’a aucune copie, jamais celle du dossier principal', () => {
    osSansConstructeur().orchestrateurPour(undefined, '', horsDepot)
    const deps = dernierRun()

    expect(deps.executionWorkspace).toBe(horsDepot)
    expect(deps.worktrees).toBeUndefined()
  })

  it('un fil rangé dans une copie du dossier principal publie dans le principal, jamais dans la copie', async () => {
    // Le fichier `.git` d'une copie de travail pointe vers le dossier commun du principal : c'est ainsi
    // qu'un fil rangé dans sa copie se rattache à son dépôt, sans que le dossier de copie soit le sien.
    const copie = join(racine, 'copie-du-principal')
    mkdirSync(join(principal, '.git', 'worktrees', 'fil'), { recursive: true })
    writeFileSync(join(principal, '.git', 'worktrees', 'fil', 'commondir'), '../..\n')
    mkdirSync(copie)
    writeFileSync(join(copie, '.git'), `gitdir: ${join(principal, '.git', 'worktrees', 'fil')}\n`)

    osSansConstructeur().orchestrateurPour(undefined, '', copie)
    const deps = dernierRun()

    expect(deps.executionWorkspace).toBe(copie)
    expect(deps.worktrees).toBe(coordPrincipal)

    const fermeture = deps.closeGreenRun as Fermeture
    fermeture.begin('run-3')
    await fermeture.close({ runId: 'run-3', task: 'tâche' })
    expect(espions.publications).toEqual([principal])
  })
})
