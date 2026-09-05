import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cumulerAccesBloquant,
  demarrerDetecteurDeGel,
  marquerOperation,
  preleverAccesCumules
} from './gel-main'
import type { Gel } from '../shared/gel-detector'

/*
 * CE QUE CE TEST INTERDIT — mesure du 2026-09-05 sur `.autowin-data/autowin-os/gels.jsonl` :
 * 363 gels sortis en `operation:'inconnu'` (1392 s de fenetre figee), dont 134 transportaient
 * pourtant l'appelant du coupable dans `accumulation[].appelant`, et ZERO ne le portait au premier
 * plan. Un gel qui SAIT d'ou il vient et ne le dit pas oblige a refouiller le depot a chaque
 * diagnostic. Le blocage est ici REELLEMENT provoque (boucle tenue), jamais simule.
 */

/** Tient la boucle d'evenements, comme le ferait un appel disque lent. */
function bloquerLaBoucle(ms: number): void {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    /* aucun await : la boucle est tenue */
  }
}

beforeEach(() => {
  marquerOperation('')
  preleverAccesCumules()
})

describe('gel non declare — l’origine remonte au premier plan', () => {
  it('nomme l’appelant du contributeur le plus couteux quand rien n’est declare', async () => {
    const captures: Gel[] = []
    const arreter = demarrerDetecteurDeGel(
      mkdtempSync(join(tmpdir(), 'gel-origine-')),
      20,
      (g) => captures.push(g),
      30
    )
    cumulerAccesBloquant('execFileSync powershell.exe', 55, 'main/index.js:1:1 < worktree.js:2:2')
    cumulerAccesBloquant('readFileSync', 5, 'main/index.js:9:9 < autre.js:3:3')
    bloquerLaBoucle(70)
    await new Promise((r) => setTimeout(r, 90))
    arreter()

    const gel = captures.find((g) => g.operation === 'inconnu')
    expect(gel).toBeDefined()
    expect(gel?.appelant).toBe('main/index.js:1:1 < worktree.js:2:2')
  })

  it('CAS LIMITE — n’invente aucune origine quand aucun appelant n’a ete capture', async () => {
    const captures: Gel[] = []
    const arreter = demarrerDetecteurDeGel(
      mkdtempSync(join(tmpdir(), 'gel-origine-')),
      20,
      (g) => captures.push(g),
      30
    )
    cumulerAccesBloquant('readFileSync', 60)
    bloquerLaBoucle(70)
    await new Promise((r) => setTimeout(r, 90))
    arreter()

    const gel = captures.find((g) => g.operation === 'inconnu')
    expect(gel).toBeDefined()
    expect(gel?.appelant).toBeUndefined()
  })

  it('CAS LIMITE — un gel DEJA nomme n’est pas re-accuse par un appelant', async () => {
    const captures: Gel[] = []
    marquerOperation('test:operation-declaree')
    const arreter = demarrerDetecteurDeGel(
      mkdtempSync(join(tmpdir(), 'gel-origine-')),
      20,
      (g) => captures.push(g),
      30
    )
    cumulerAccesBloquant('execFileSync powershell.exe', 55, 'main/index.js:1:1 < worktree.js:2:2')
    bloquerLaBoucle(70)
    await new Promise((r) => setTimeout(r, 90))
    arreter()

    const gel = captures.find((g) => g.operation === 'test:operation-declaree')
    expect(gel).toBeDefined()
    expect(gel?.appelant).toBeUndefined()
  })
})
