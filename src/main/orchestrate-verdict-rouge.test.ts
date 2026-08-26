import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UN RUN BLOQUÉ OU REFUSÉ NE PEUT PAS SORTIR VERT.
 *
 * DÉFAUT MESURÉ, présent dans main jusqu'au 2026-08-26. Le statut terminal se calculait ainsi :
 *
 *     terminalLifecycle && closure.status !== 'open' ? closure.status
 *       : gateBlocked ? 'red' : 'green'
 *
 * Le cycle de vie passait AVANT le gate. Un run dont le gate avait BLOQUÉ, mais dont la clôture
 * portait `green`, ressortait donc VERT — le gate était consulté trop tard pour compter. Et
 * `!r.valid` (le juge a REFUSÉ le livrable) n'était pas regardé du tout, ni dans le statut, ni dans
 * l'événement diffusé.
 *
 * L'ORDRE EST LA CORRECTION. Ce test garde l'ordre, pas la présence des mots : un `gateBlocked`
 * écrit après le cycle de vie serait syntaxiquement valide et ramènerait le faux vert.
 *
 * Récupéré du bureau `autowin/recovery/command-edit-21663348-…` (2026-08-15), jamais publié.
 */
const SOURCE = readFileSync(join(__dirname, 'commands.ts'), 'utf8').replace(/\s+/g, ' ')

describe('verdict d’orchestration — le rouge prime', () => {
  it('le gate et le refus du juge sont évalués AVANT le cycle de vie', () => {
    const i = SOURCE.indexOf('const terminalStatus =')
    expect(i, 'terminalStatus a disparu — ce garde ne garde plus rien').toBeGreaterThan(0)
    const bloc = SOURCE.slice(i, i + 320)

    const posGate = bloc.indexOf('r.gateBlocked')
    const posValide = bloc.indexOf('!r.valid')
    const posCycle = bloc.indexOf('terminalLifecycle')

    expect(posGate, 'le gate doit être testé').toBeGreaterThan(-1)
    expect(posValide, 'le refus du juge doit être testé').toBeGreaterThan(-1)
    expect(posCycle, 'le cycle de vie doit rester consulté').toBeGreaterThan(-1)
    // L'ENTRÉE QUI DOIT FAIRE ÉCHOUER : remettre le cycle de vie en tête, comme avant.
    expect(posGate, 'le gate doit précéder le cycle de vie').toBeLessThan(posCycle)
    expect(posValide, 'le refus du juge doit précéder le cycle de vie').toBeLessThan(posCycle)
  })

  it('l’événement diffusé compte le refus du juge, pas seulement le gate', () => {
    // `status: r.gateBlocked ? 'red' : 'green'` — la version d'avant — annonçait VERT un livrable
    // que le juge venait de refuser.
    expect(SOURCE).toContain("status: r.gateBlocked || !r.valid ? 'red' : 'green'")
  })
})
