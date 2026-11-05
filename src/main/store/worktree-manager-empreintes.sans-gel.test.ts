import { ChildProcess } from 'node:child_process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from '../execution-hors-fil'
import { empreinteConnue, oublierEmpreintesProcessus } from './worktree-manager-empreintes'

/**
 * LA SONDE D'EMPREINTE NE CRÉE PLUS SON POWERSHELL SUR LE FIL PRINCIPAL (conv-1574, 2026-11-05).
 *
 * Mesure `gels.jsonl` depuis le démarrage de 09:34 UTC (`node scripts/gels-classement.mjs
 * --depuis 2026-11-05T09:34:30Z`) : premier appelant de la fenêtre figée, `spawn powershell.exe`
 * depuis `worktree-manager-empreintes.ts:177` < `:326`, 13 appels, 82,8 s, dont 31,9 s d'un coup à
 * 09:51:40. Le sondage était déjà « asynchrone » (`execFile` plutôt qu'`execFileSync`, conv-1508),
 * mais `execFile` ne l'est que pour la suite : la CRÉATION du processus bloque le fil qui l'appelle,
 * et sur ce poste elle attend au-dessus du disque (une sentinelle hors de l'app y est restée 45,7 s,
 * `scripts/trace-blocage-disque.ps1`, même jour).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : le sondage de fond qui repasse par `execFile` du fil principal.
 */
afterAll(async () => {
  await arreterFilDExecution()
})

describe('empreinteConnue — sondage de fond', () => {
  it('lit l empreinte sans créer un seul processus sur le fil principal', async () => {
    oublierEmpreintesProcessus()
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      // Premier appel : rien en mémoire, la sonde part en fond et la réponse est « non lue ».
      expect(empreinteConnue(process.pid)).toBe(null)
      expect(creations).not.toHaveBeenCalled()

      // La sonde de fond remplit bien la mémoire : l'empreinte réelle de CE processus arrive.
      let empreinte: string | null | undefined = null
      const limite = Date.now() + 80_000
      while (empreinte === null && Date.now() < limite) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        empreinte = empreinteConnue(process.pid)
      }
      expect(empreinte).toEqual(expect.any(String))
      expect(empreinte).not.toBe('')
      expect(creations).not.toHaveBeenCalled()
    } finally {
      creations.mockRestore()
    }
  }, 90_000)
})
