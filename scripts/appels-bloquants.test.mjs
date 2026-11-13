import { describe, expect, it } from 'vitest'
import {
  compter,
  estSurveille,
  fichiersSurveilles,
  lirePlancher,
  mesurer,
  messageDeRefus
} from './appels-bloquants.mjs'
import { depassements } from './cliquet-par-fichier.mjs'

/**
 * Aucun appel bloquant de plus dans le processus principal : un `execFileSync` fige toute la fenêtre
 * jusqu'à la fin du processus lancé (le `git log` du Board, 120 s d'un bloc le 2026-11-13).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : ajouter `execFileSync('git', ['status'])` à n'importe quel
 * fichier de `src/main` hors tests, ou créer un fichier qui en contient un.
 */

const IMPORT = "import { execFileSync, execSync, spawnSync } from 'node:child_process'\n"

describe('ce qui compte comme un appel bloquant', () => {
  it.each([
    ["execFileSync('git', ['status'])"],
    ["execSync('dir')"],
    ["spawnSync('powershell.exe', [])"],
    ["const r = require('node:child_process').execSync('dir')"],
    ["import * as cp from 'node:child_process'\ncp.spawnSync('git', [])"]
  ])('voit %s', (code) => {
    expect(compter(`${IMPORT}${code}\n`)).toBe(1)
  })

  it('voit la fonction passée par défaut à un paramètre : elle sera appelée sous un autre nom', () => {
    const code = `${IMPORT}export function tuer(executer: typeof spawnSync = spawnSync) {\n  executer('taskkill', [])\n}\n`
    expect(compter(code)).toBe(1)
  })

  it('voit un alias d import', () => {
    const code = "import { execFileSync as lancer } from 'node:child_process'\nlancer('git', [])\n"
    expect(compter(code)).toBe(1)
  })

  it('ne compte ni l import, ni un commentaire, ni une chaîne, ni un type', () => {
    const code = [
      IMPORT,
      '// ancien gel : execFileSync git rev-parse x60',
      '/* `spawnSync` tenait la fenêtre */',
      "const cibles = ['execSync', 'execFileSync', 'spawnSync']",
      'let lanceur: typeof spawnSync | undefined',
      'type R = ReturnType<typeof execFileSync>'
    ].join('\n')
    expect(compter(code)).toBe(0)
  })

  it('ne prend pas le nom déclaré d une propriété pour un appel', () => {
    const code =
      'interface Outils { spawnSync: (c: string) => void }\nconst o = { spawnSync: () => {} }\n'
    expect(compter(code)).toBe(0)
  })

  it('accepte un appel assumé seulement si la ligne dit pourquoi', () => {
    const avecRaison = `${IMPORT}spawnSync('taskkill', []) // appel-bloquant-assume: exit n accepte que du synchrone\n`
    const sansRaison = `${IMPORT}spawnSync('taskkill', []) // appel-bloquant-assume:\n`
    expect(compter(avecRaison)).toBe(0)
    expect(compter(sansRaison)).toBe(1)
  })
})

describe('ce qui est surveillé', () => {
  it('prend le processus principal, pas ses tests ni le reste du dépôt', () => {
    expect(estSurveille('src/main/board/arrivee-sur-main.ts')).toBe(true)
    expect(estSurveille('src/main/board/arrivee-sur-main.test.ts')).toBe(false)
    expect(estSurveille('src/main/board/arrivee-sur-main.sans-gel.test.ts')).toBe(false)
    expect(estSurveille('src/main/store/worktree-manager.test-helpers.ts')).toBe(false)
    expect(estSurveille('src/main/orchestration/e2e-chaine.harness.ts')).toBe(false)
    expect(estSurveille('src/renderer/src/components/ChatView.tsx')).toBe(false)
    expect(estSurveille('scripts/couleurs-en-dur.mjs')).toBe(false)
  })
})

describe('le refus', () => {
  it('dit quoi écrire à la place', () => {
    const texte = messageDeRefus([{ chemin: 'src/main/neuf.ts', compte: 1, plafond: 0 }])
    expect(texte).toContain('src/main/neuf.ts : 1 appel(s) bloquant(s), 0 au plus')
    expect(texte).toContain('execFileHorsFil (src/main/gel/execution-hors-fil.ts)')
    expect(texte).toContain('appel-bloquant-assume: <raison>')
  })
})

describe('le processus principal du dépôt', () => {
  it('scanne bien les fichiers du processus principal', () => {
    // Sans ce cas, un parcours de dossiers cassé rendrait le suivant vert à vide.
    expect(fichiersSurveilles().length).toBeGreaterThanOrEqual(500)
    expect(Object.keys(lirePlancher()).length).toBeGreaterThanOrEqual(10)
  })

  it('n ajoute aucun appel bloquant au-delà du plancher', () => {
    const fautes = depassements(mesurer(), lirePlancher())
    expect(fautes, messageDeRefus(fautes)).toEqual([])
  })
})
