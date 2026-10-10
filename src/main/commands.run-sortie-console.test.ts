import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'

/**
 * LA SORTIE D'UNE COMMANDE WINDOWS DOIT ARRIVER LISIBLE, ACCENTS COMPRIS.
 *
 * DEFAUT VECU. `murs-rencontres.json` gardait deux sorties renvoyees a l'agent avec des « � » :
 * conv-92 « verify … ex�cutable ou un fichier de commandes » et conv-129 « run … ping … re�us ».
 * Sous Windows, `cmd.exe` et les outils du systeme (`ping`) ecrivent dans la page de code OEM de la
 * console (850 sur un poste francais : « é » = 0x82), et `spawnVerify` decodait chaque morceau en
 * UTF-8 : tout octet >= 0x80 isole devenait U+FFFD, et l'agent lisait un message mutile.
 *
 * Ce test exerce le VRAI `spawnVerify`, avec le vrai `cmd.exe` : c'est la console du poste qui
 * choisit l'encodage, aucun faux ne le reproduirait. L'assertion ne depend pas de la langue de
 * Windows : en anglais la sortie est en ASCII et passe de toute facon ; en francais elle portait
 * des « � » avant la correction.
 */
type Message = { role: 'user' | 'assistant'; content: string }

function busAvecFil(messages: Message[]): AppCommandBus {
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: () => ({ id: 'conv-1', messages }),
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

const BINAIRE_ABSENT = 'binaireabsentautowinxyz'

describe.skipIf(process.platform !== 'win32')(
  'run — la sortie console Windows est décodée dans sa vraie page de code',
  () => {
    beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-oem-'))))

    it('ping (conv-129) : aucun caractère de remplacement dans ce que reçoit l’agent', async () => {
      const bus = busAvecFil([{ role: 'user', content: 'Autorise les commandes ping' }])

      const resultat = (await bus.exec('run', { commande: 'ping -n 1 127.0.0.1' }, 'conv-1'))
        .data as { exitCode?: number | null; detail?: string }

      expect(resultat.exitCode).toBe(0)
      expect(String(resultat.detail)).toContain('127.0.0.1')
      expect(String(resultat.detail)).not.toContain('\uFFFD')
    }, 20_000)

    it('message d’erreur de cmd.exe (conv-92) : lisible, accents compris', async () => {
      const bus = busAvecFil([
        { role: 'user', content: `Autorise les commandes ${BINAIRE_ABSENT}` }
      ])

      const resultat = (await bus.exec('run', { commande: BINAIRE_ABSENT }, 'conv-1')).data as {
        exitCode?: number | null
        detail?: string
      }

      expect(resultat.exitCode).not.toBe(0)
      expect(String(resultat.detail)).toContain(BINAIRE_ABSENT)
      expect(String(resultat.detail)).not.toContain('\uFFFD')
    }, 20_000)
  }
)
