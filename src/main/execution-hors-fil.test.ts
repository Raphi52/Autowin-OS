import { ChildProcess } from 'node:child_process'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution, execFileHorsFil } from './execution-hors-fil'

/**
 * LE LANCEUR HORS FIL (heal « les lags », conv-1413, 2026-10-31).
 *
 * `gels.jsonl` mesure la création d'un processus par la couture `ChildProcess.prototype.spawn`
 * (`gel-main.ts`). L'assertion qui garde le correctif : cette couture n'est JAMAIS appelée sur le
 * fil qui exécute le test, alors que la commande a bien tourné et rendu sa sortie.
 */
// `spawn` du prototype n'est pas typé (méthode interne de Node) : c'est pourtant la couture mesurée.
const espionnerCreations = () =>
  vi.spyOn(ChildProcess.prototype as unknown as { spawn: () => unknown }, 'spawn')
let creations: ReturnType<typeof espionnerCreations>
beforeEach(() => {
  creations = espionnerCreations()
})
afterEach(() => creations.mockRestore())
afterAll(() => arreterFilDExecution())

describe('execFileHorsFil', () => {
  it('rend la sortie, avec le dossier et l’environnement donnés, sans créer de processus sur ce fil', async () => {
    const { stdout, stderr } = await execFileHorsFil(
      process.execPath,
      [
        '-e',
        'process.stdout.write(process.env.MARQUE + "|" + process.cwd()); process.stderr.write("e")'
      ],
      { env: { ...process.env, MARQUE: 'vu' }, cwd: process.cwd(), windowsHide: true }
    )
    expect(stdout).toBe(`vu|${process.cwd()}`)
    expect(stderr).toBe('e')
    expect(creations).not.toHaveBeenCalled()
  })

  it('rejette comme execFile sur un code de sortie non nul, avec code et sorties', async () => {
    const erreur = await execFileHorsFil(process.execPath, [
      '-e',
      'process.stdout.write("o"); process.stderr.write("x"); process.exit(3)'
    ]).catch((e: unknown) => e as { code?: unknown; stdout?: string; stderr?: string })
    expect(erreur).toMatchObject({ code: 3, stdout: 'o', stderr: 'x' })
    expect(erreur).toBeInstanceOf(Error)
  })

  it('rejette ENOENT pour un programme introuvable, et reste utilisable ensuite', async () => {
    await expect(execFileHorsFil('programme-absent-aos-1413.exe', [])).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const { stdout } = await execFileHorsFil(process.execPath, ['-e', 'process.stdout.write("ok")'])
    expect(stdout).toBe('ok')
  })

  it('tient plusieurs commandes en parallèle sans mélanger leurs sorties', async () => {
    const sorties = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        execFileHorsFil(process.execPath, [
          '-e',
          `setTimeout(() => process.stdout.write("${n}"), ${50 * (5 - n)})`
        ])
      )
    )
    expect(sorties.map((s) => s.stdout)).toEqual(['1', '2', '3', '4'])
  })

  it('applique le délai d’execFile (processus tué, killed=true)', async () => {
    await expect(
      execFileHorsFil(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 200 })
    ).rejects.toMatchObject({ killed: true })
  })

  it('se recrée après un arrêt du fil', async () => {
    await arreterFilDExecution()
    const { stdout } = await execFileHorsFil(process.execPath, ['-e', 'process.stdout.write("re")'])
    expect(stdout).toBe('re')
  })
})
