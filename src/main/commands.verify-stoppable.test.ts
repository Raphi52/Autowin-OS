import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'

/**
 * LE BOUTON STOP DOIT ATTEINDRE `verify`, comme il atteint `run` (commands.run-stoppable.test.ts).
 *
 * DEFAUT VECU (conv-978, 2026-10-15) : « mon bouton stop relance 3x le tour ». Stop clique pendant
 * un `verify type:typecheck` : le tour etait clos, mais `tsc` a continue 15 s, et ses trois
 * battements (15 s, 20 s, 25 s) sont arrives a l'ecran apres la fin du tour — chacun rallumait
 * « en cours ». `spawnVerify` savait tuer l'arbre sur signal ; `runVerify` ne le lui passait pas.
 *
 * Vrai process, vrai `spawnVerify` : un mock prouverait seulement qu'on lui passe un argument.
 */
function busSur(workspace: string): AppCommandBus {
  const os = {
    executionWorkspace: workspace,
    conversations: {
      get: () => ({ id: 'conv-1', messages: [] }),
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  return new AppCommandBus(os as never, () => {})
}

/** Un projet dont le script de preuve occupe le terrain 30 s : assez pour qu'un Stop ait un sens. */
function projetLent(script: 'typecheck' | 'test'): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-verify-stop-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'verify-stop',
      private: true,
      scripts: { [script]: 'node -e "setTimeout(function(){},30000)"' }
    })
  )
  return dir
}

type Issue = { ok?: boolean; exitCode?: number | null; output?: string }

describe('verify — le Stop de l’utilisateur coupe la vérification lancée', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-stop-'))))

  for (const type of ['typecheck', 'test'] as const) {
    it(`${type} : rend la main tout de suite quand le tour est interrompu`, async () => {
      const bus = busSur(projetLent(type))
      const controller = new AbortController()
      bus.signalDuTour = () => controller.signal

      const debut = Date.now()
      const promesse = bus.exec('verify', { type }, 'conv-1')
      // Laisse le process demarrer pour de bon : couper avant le spawn ne prouverait rien.
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      controller.abort('user')

      const issue = (await promesse).data as Issue
      // Le script dure 30 s, le plafond bien plus encore : revenir vite ne vient que de la mise a mort.
      expect(Date.now() - debut).toBeLessThan(10_000)
      expect(issue.ok).toBe(false)
      expect(issue.exitCode).toBeNull()
      expect(String(issue.output)).toContain('arret demande')
    }, 25_000)
  }
})

/**
 * CONTRAT DE SOURCE (meme idiome que run-pilot-chat.orientation.test.ts) — il ne prouve pas le
 * chemin de bout en bout. Un tour CLOS ne diffuse plus rien a l'ecran : sans ce garde, n'importe
 * quelle action encore vivante apres Stop (verify, edit_file, orchestrate) ressuscitait le tour.
 */
describe('un tour clos ne diffuse plus d’événement à l’écran (conv-978)', () => {
  const source = readFileSync(join(__dirname, 'chat', 'run-pilot-chat.ts'), 'utf8')
  it('le finally marque le tour clos', () => {
    expect(source).toMatch(/\} finally \{\s*tourClos = true/)
  })
  it('la diffusion en direct est coupée une fois le tour clos', () => {
    expect(source).toMatch(
      /if \(tourClos\) return\s*emitToLiveWindows\(BrowserWindow\.getAllWindows\(\), 'pilot:event'/
    )
  })
})
