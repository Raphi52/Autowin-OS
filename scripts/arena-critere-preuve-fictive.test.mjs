import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertionPreuveFictive,
  cheminsInvoques,
  preuvesFictives
} from './arena-critere-preuve-fictive.mjs'

const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

/** Un depot minimal qui contient `scripts/reel.mjs` et rien d'autre. */
function depot() {
  const racine = mkdtempSync(join(tmpdir(), 'arena-preuve-'))
  aNettoyer.push(racine)
  mkdirSync(join(racine, 'scripts'), { recursive: true })
  writeFileSync(join(racine, 'scripts', 'reel.mjs'), '// outil qui existe\n')
  return racine
}

describe('preuve fictive — le defaut mesure au banc clean du 2026-09-05', () => {
  it('refuse un rapport qui invoque un script absent du depot', () => {
    const racine = depot()
    const rap = 'Empreinte calculee :\n\n```\npython scripts/fingerprint.py src/App.tsx\n```\n'
    expect(preuvesFictives(rap, racine)).toEqual(['scripts/fingerprint.py'])
    expect(assertionPreuveFictive(rap, racine).ok).toBe(false)
  })

  it('accepte un rapport qui invoque un script REEL du depot', () => {
    const racine = depot()
    const rap = 'Preuve rejouee :\n\n```\nnode scripts/reel.mjs .\n```\n'
    expect(preuvesFictives(rap, racine)).toEqual([])
    expect(assertionPreuveFictive(rap, racine).detail).toContain('1 commande(s) verifiee(s)')
  })

  it('un fichier RETIRE par le nettoyage n_est PAS une preuve fictive', () => {
    const racine = depot()
    const rap = [
      '## Retire',
      '- `perf-essai-streaming.mjs` — script d_essai du run, supprime',
      '- `Markdown.tsx.bak` — sauvegarde, supprimee'
    ].join('\n')
    expect(preuvesFictives(rap, racine)).toEqual([])
  })

  it('attrape aussi un outil `scripts/…` cite en code sans interpreteur', () => {
    const racine = depot()
    expect(preuvesFictives('empreinte via `scripts/fingerprint.py`', racine)).toEqual([
      'scripts/fingerprint.py'
    ])
  })

  it('dedoublonne : le meme script cite trois fois ne compte qu_une fois', () => {
    const racine = depot()
    const rap = 'python scripts/fake.py a\npython scripts/fake.py b\n`scripts/fake.py`\n'
    expect(cheminsInvoques(rap)).toEqual(['scripts/fake.py'])
    expect(preuvesFictives(rap, racine)).toEqual(['scripts/fake.py'])
  })

  it('rapport sans aucune commande : tenu, et le detail le dit (0 verifiee)', () => {
    const racine = depot()
    const a = assertionPreuveFictive('Rien nettoye, rien execute.', racine)
    expect(a.ok).toBe(true)
    expect(a.detail).toContain('0 commande(s)')
  })
})
