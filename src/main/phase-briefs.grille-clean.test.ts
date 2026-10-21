import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/*
 * LA GRILLE QUALITÉ DE CLEAN VIT EN DEUX COUCHES (conv-1035, 2026-10-21).
 *
 * Le pipeline in-app ne lit que `PHASE_BRIEFS.clean` ; `/clean` invoqué dans le chat lit
 * `skills/clean/SKILL.md`. La grille est écrite deux fois : courte ici, avec la preuve attendue
 * par critère là-bas. Sans lien, un critère ajouté d'un côté manque en silence de l'autre, et les
 * deux chemins notent le même code sur deux grilles différentes. Ce test compare les deux LISTES,
 * pas leurs phrases.
 */

const sansAccent = (texte: string): string =>
  texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Les critères de la consigne in-app : la liste « A (…) · B · C (…) » de la ligne GRILLE QUALITÉ. */
function criteresDeLaConsigne(): string[] {
  const ligne = PHASE_BRIEFS.clean.split('\n').find((l) => l.includes('GRILLE QUALITÉ')) ?? ''
  const liste = /un verdict par critère : (.*?)\. Verdict =/.exec(ligne)?.[1] ?? ''
  return liste
    .split(' · ')
    .map((morceau) => morceau.replace(/\s*\(.*$/, '').trim())
    .filter(Boolean)
}

/** Les critères du SKILL.md : la première colonne du tableau de « ## La grille qualite ». */
function criteresDuSkill(): string[] {
  const texte = readFileSync('skills/clean/SKILL.md', 'utf8').replace(/\r\n/g, '\n')
  const section = texte.split('## La grille qualite')[1]?.split('\n## ')[0] ?? ''
  return section
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Critere'))
    .map((l) => l.split('|')[1].trim())
}

describe('grille qualité de clean', () => {
  it('lit bien une grille non triviale des deux côtés (sinon la comparaison ne prouve rien)', () => {
    expect(criteresDeLaConsigne().length).toBeGreaterThanOrEqual(10)
    expect(criteresDuSkill().length).toBeGreaterThanOrEqual(10)
  })

  it('la consigne in-app et le SKILL.md notent sur les MÊMES critères', () => {
    expect(criteresDeLaConsigne().map(sansAccent)).toEqual(criteresDuSkill().map(sansAccent))
  })

  it('chaque verdict exige sa preuve, et un goût ne fait pas un défaut', () => {
    const clean = PHASE_BRIEFS.clean
    expect(clean).toContain('✅ + preuve lue')
    expect(clean).toContain('❌ + file:line + règle violée')
    expect(clean).toContain('« sans objet »')
    expect(clean).toContain("Un goût sans règle violée n'est pas un ❌")
    expect(clean).toContain('« ❌ restant »')
  })

  it('les corrections de la grille passent AVANT le dernier rejeu que le juge réutilise', () => {
    const clean = PHASE_BRIEFS.clean
    const grille = clean.indexOf('GRILLE QUALITÉ')
    expect(grille).toBeGreaterThan(-1)
    expect(grille).toBeLessThan(clean.indexOf('DERNIER geste'))
  })

  it('un ❌ qui change un comportement part au juge, jamais par une bifurcation vers build', () => {
    // workflow-walk.ts (nextNode) honore une phase sans arête SANS consommer de budget : une
    // ligne `SUITE: build` écrite par clean ouvrirait une boucle build ↔ clean non bornée.
    expect(PHASE_BRIEFS.clean).not.toMatch(/SUITE\s*:\s*build/i)
  })
})
