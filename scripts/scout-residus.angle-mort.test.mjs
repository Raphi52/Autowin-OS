import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// Pourquoi ce test : la sonde ne lit que .ts/.tsx/.mts/.js/.jsx/.mjs/.cjs. Sur `scripts/`,
// 67 des 165 fichiers (41 %) sont hors de ce filtre — .ps1, .py, .vbs. Un rapport muet sur
// ce trou se lit comme un inventaire complet. Mesure du banc /arena du 2026-09-05 : les trois
// bras qui suivaient la sonde ont perdu contre un balayage direct, sur cet angle mort exactement.
const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

const dossier = (fichiers) => {
  const d = mkdtempSync(join(tmpdir(), 'scout-residus-'))
  aNettoyer.push(d)
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(d, nom), contenu, 'utf8')
  return d
}

const sonde = (racine) =>
  execFileSync(process.execPath, ['scripts/scout-residus.mjs', racine], { encoding: 'utf8' })

describe('scout-residus — angle mort', () => {
  it('nomme les extensions NON analysees et les compte', () => {
    const d = dossier({
      'vivant.mjs': 'export const a = 1\n',
      'runner.ps1': 'Set-Location C:/nulle-part\n',
      'autre.ps1': 'Write-Host x\n',
      'outil.py': 'print(1)\n'
    })
    const rapport = sonde(d)
    expect(rapport).toMatch(/## 0\. Angle mort — 3 fichier\(s\) NON analysé\(s\)/)
    expect(rapport).toMatch(/`\.ps1` : 2/)
    expect(rapport).toMatch(/`\.py` : 1/)
  })

  it('dit explicitement "aucun" quand tout est couvert, au lieu de se taire', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'export const a = 1\n' }))
    expect(rapport).toMatch(/## 0\. Angle mort — aucun/)
  })

  it('place l angle mort AVANT la premiere section de candidats', () => {
    const rapport = sonde(dossier({ 'a.mjs': 'export const a = 1\n', 'b.ps1': 'x\n' }))
    expect(rapport.indexOf('## 0. Angle mort')).toBeLessThan(rapport.indexOf('## 1. Fichiers'))
  })
})
