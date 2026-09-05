import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isolerTemp, type TempIsole } from './temp-isole.test-helpers'
import { ClaudeCliAdapter } from './claude'

/*
 * Deuxieme fuite, distincte de l'echec de spawn : les dossiers temporaires sont crees AVANT le
 * lancement du CLI, et plusieurs sorties par exception se produisent entre les deux (garde
 * anti-ligne-de-commande-trop-longue, journal survivable indisponible, echec de onJournal).
 * Sur ces chemins, aucun menage n'etait fait — le couple system-prompt + settings restait dans
 * %TEMP%. Test au SITE D'APPEL : on declenche la garde de longueur avec un `--resume` enorme.
 */
const consommer = async (gen: AsyncIterable<unknown>): Promise<void> => {
  for await (const _ of gen) void _
}

describe('claude — une exception AVANT le lancement ne laisse aucun temporaire', () => {
  let temp: TempIsole
  beforeEach(() => {
    temp = isolerTemp()
  })
  afterEach(() => {
    temp.demonter()
  })

  it('nettoie quand la ligne de commande est refusee (trop longue)', async () => {
    const avant = new Set(temp.lister())
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }], {
      system: 'S'.repeat(5_000),
      resumeSessionId: 'R'.repeat(200_000)
    })
    await expect(consommer(gen)).rejects.toThrow(/trop longue/)
    expect(temp.lister().filter((nom) => !avant.has(nom))).toEqual([])
  })

  it('nettoie quand le journal survivable est indisponible alors que onJournal est requis', async () => {
    const avant = new Set(temp.lister())
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }], {
      system: 'S'.repeat(5_000),
      onJournal: () => {}
    })
    await expect(consommer(gen)).rejects.toThrow(/[Jj]ournal/)
    expect(temp.lister().filter((nom) => !avant.has(nom))).toEqual([])
  })
})
