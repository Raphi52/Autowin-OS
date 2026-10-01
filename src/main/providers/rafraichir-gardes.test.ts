import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NOM_SCRIPT_GARDE, rafraichirGardesDesAgents } from './rafraichir-gardes'

/**
 * Mesuré le 2026-10-01 (conv-770) : l'agent de conv-890, lancé à 12:45 et vivant après le
 * redémarrage de 12:54, gardait l'ANCIENNE garde Python — son script de hook est écrit à son
 * lancement et jamais réécrit.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})
const racine = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'autowin-rafraichir-'))
  racines.push(r)
  return r
}
const reglages = (r: string, nom: string, script?: string, ageMs = 0): string => {
  const d = join(r, nom)
  mkdirSync(d)
  if (script !== undefined) writeFileSync(join(d, NOM_SCRIPT_GARDE), script, 'utf8')
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000
    utimesSync(d, t, t)
  }
  return d
}

describe('rafraichirGardesDesAgents', () => {
  it('remplace le script d’un agent encore vivant par la garde courante', () => {
    const r = racine()
    const d = reglages(r, 'autowin-os-settings-vivant', 'ancienne garde')
    const res = rafraichirGardesDesAgents({ racine: r, script: 'garde courante' })
    expect(res.rafraichis).toEqual(['autowin-os-settings-vivant'])
    expect(readFileSync(join(d, NOM_SCRIPT_GARDE), 'utf8')).toBe('garde courante')
    // Aucun fichier provisoire ne reste derrière le renommage.
    expect(readdirSync(d)).toEqual([NOM_SCRIPT_GARDE])
  })

  it('ne touche ni un dossier de plus de 24 h, ni un dossier tiers, ni un dossier sans script', () => {
    const r = racine()
    const vieux = reglages(r, 'autowin-os-settings-vieux', 'ancienne', 25 * 3_600_000)
    const tiers = reglages(r, 'autre-outil-settings-x', 'ancienne')
    reglages(r, 'autowin-os-settings-vide')
    const res = rafraichirGardesDesAgents({ racine: r, script: 'courante' })
    expect(res).toEqual({ rafraichis: [], aJour: [], echecs: [] })
    expect(readFileSync(join(vieux, NOM_SCRIPT_GARDE), 'utf8')).toBe('ancienne')
    expect(readFileSync(join(tiers, NOM_SCRIPT_GARDE), 'utf8')).toBe('ancienne')
  })

  it('un script déjà à jour n’est pas réécrit', () => {
    const r = racine()
    reglages(r, 'autowin-os-settings-ok', 'courante')
    expect(rafraichirGardesDesAgents({ racine: r, script: 'courante' }).aJour).toEqual([
      'autowin-os-settings-ok'
    ])
  })

  it('une racine illisible ne casse rien', () => {
    expect(rafraichirGardesDesAgents({ racine: join(racine(), 'absente'), script: 'x' })).toEqual({
      rafraichis: [],
      aJour: [],
      echecs: []
    })
  })

  it('est appelé au démarrage de l’app avec le MÊME script que celui écrit au lancement d’un agent', () => {
    const src = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
    expect(src('./claude.ts')).toMatch(
      /writeFileSync\(hookGarde, scriptDesGardesCourant\(\), 'utf8'\)/
    )
    expect(src('../index.ts')).toMatch(
      /rafraichirGardesDesAgents\(\{ racine: tmpdir\(\), script: scriptDesGardesCourant\(\) \}\)/
    )
  })
})
