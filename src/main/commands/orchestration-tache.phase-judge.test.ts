import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { convRunsRoot } from '../runs/conv-runs'

/**
 * DEPUIS UN FIL, LA RELECTURE DEMANDÉE RESTE UNE RELECTURE.
 *
 * Le chat joint toujours le message de l'utilisateur à `orchestrate` (`rootTask`,
 * agent-pilot/execution-des-commandes.ts) : toute phase choisie par le modèle était donc ignorée.
 * Mesuré le 2026-10-30 : un `judge` demandé depuis un fil a rejoué la demande de départ entière,
 * 87,69 $ et 26 commits que personne n'avait demandés. Une relecture ne modifie rien : la laisser
 * passer ne réduit pas le contrat de l'utilisateur. Les phases qui écrivent ou qui cadrent restent
 * ignorées, et une tâche à risque garde son pipeline complet.
 */
function osDouble(): {
  os: ConstructorParameters<typeof AppCommandBus>[0]
  calls: { lastTask?: string }
} {
  const calls: { lastTask?: string } = {}
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: () => undefined,
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    runTask: async (task: string) => {
      calls.lastTask = task
      return { ok: true }
    }
  }
  return { os: os as never, calls }
}

const DEMANDE_DU_FIL = 'Relis le travail de conv-1341 et dis-moi si le mode auto est correct.'
const convIds: string[] = []

async function lancerDepuisUnFil(phase: string, rootTask = DEMANDE_DU_FIL): Promise<string> {
  const convId = `conv-phase-fil-${phase}-${process.pid}-${Date.now().toString(36)}`
  convIds.push(convId)
  const { os, calls } = osDouble()
  await new AppCommandBus(os, () => {}).exec(
    'orchestrate',
    { task: 'audite le mode auto livré par conv-1341', phase, rootTask },
    convId
  )
  return calls.lastTask ?? ''
}

afterEach(() => {
  for (const convId of convIds.splice(0)) {
    rmSync(join(convRunsRoot(), convId), { recursive: true, force: true })
  }
})

describe('phase demandée depuis un fil (rootTask présent)', () => {
  it('judge passe : le run ne fait que relire, sur la demande de l’utilisateur', async () => {
    const tache = await lancerDepuisUnFil('judge')

    expect(tache).toMatch(/^\/judge /)
    expect(tache).toContain(DEMANDE_DU_FIL)
  })

  for (const phase of ['build', 'frame', 'clean']) {
    it(`${phase} reste ignorée : le message de l’utilisateur garde l’autorité`, async () => {
      const tache = await lancerDepuisUnFil(phase)

      expect(tache).not.toMatch(/^\/[a-z]+ /)
      expect(tache).toContain(DEMANDE_DU_FIL)
    })
  }

  it('judge ne réduit pas une tâche à risque à une simple relecture', async () => {
    const critique = "Refactorer toute l'architecture de securite du coffre a cles."
    const tache = await lancerDepuisUnFil('judge', critique)

    expect(tache).not.toMatch(/^\/judge /)
    expect(tache).toContain(critique)
  })
})
