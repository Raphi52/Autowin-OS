import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { skillRoots } from './native-registry'
import { invokedSkillId, skillInstruction } from './skill-pipeline'

/**
 * CONTRATS DE TEXTE VÉRIFIÉS PAR SONDE, pas par relecture.
 *
 * Demande du 2026-09-04 : (1) `/arena` doit mesurer les QUATRE dimensions (qualité, coût, temps,
 * efficacité) ; (2) `/arena /<skill> <cible>` — donc `/arena /heal autowin os` — doit être un banc
 * complet, la skill nommée devenant le workflow testé ; (3) `/heal` doit pouvoir mener une
 * optimisation de perf SANS mesure chronométrable, via un critère statique COMPTÉ et localisé.
 * Ces trois contrats vivent dans du texte injecté : sans test, un futur remaniement les efface sans
 * rien casser de visible.
 */
function corpsSkill(id: string): string {
  const injecte = skillInstruction(id, skillRoots())
  expect(injecte).not.toBe('')
  return injecte
}

describe('arena mesure les quatre dimensions et accepte une skill comme tâche', () => {
  const arena = corpsSkill('arena')

  it('nomme explicitement qualité, coût, temps et efficacité', () => {
    expect(arena).toMatch(/QUATRE dimensions/i)
    for (const dimension of [/QUALITÉ/, /COÛT/, /TEMPS/, /EFFICACITÉ/]) {
      expect(arena).toMatch(dimension)
    }
    // Le rendement se lit, il ne s'estime pas.
    expect(arena).toContain('total_cost_usd')
    expect(arena).toContain('durationMs')
    expect(arena).toMatch(/non mesuré/)
  })

  it('traite `/arena /<skill> <cible>` comme un banc complet, sans réclamer de reformulation', () => {
    expect(arena).toContain('/arena /heal autowin os')
    expect(arena).toMatch(/la skill nommée devient le WORKFLOW testé/i)
  })

  it('garde le témoin A et le juge externe', () => {
    expect(arena).toMatch(/A est le témoin obligatoire/)
    expect(arena).toMatch(/judge/)
  })
})

describe('heal peut optimiser sans mesure, mais jamais sans cause localisée', () => {
  const heal = corpsSkill('heal')

  it('ouvre un chemin statique quand aucun chronomètre n’est possible', () => {
    expect(heal).toMatch(/NO MEASUREMENT AVAILABLE/i)
    expect(heal).toMatch(/do NOT drop the candidate and do NOT stop the heal/i)
    for (const famille of [/O\(n²\)/, /N times where 1 suffices/i, /[Ss]ynchronous I\/O/]) {
      expect(heal).toMatch(famille)
    }
  })

  it('exige la localisation et interdit d’annoncer un gain non mesuré', () => {
    expect(heal).toMatch(/file:line/)
    expect(heal).toMatch(/gain non mesuré — cause localisée/)
    expect(heal).toMatch(/No localisation → the candidate is dropped/i)
  })

  it('a des dents : la description du sélecteur ne promet plus « no symptom, no heal » sans issue', () => {
    const brut = readFileSync(join(skillRoots()[0], 'heal', 'SKILL.md'), 'utf8')
    expect(brut).toMatch(/COUNTED static criterion/i)
  })
})

describe('les deux commandes sont routables', () => {
  it('reconnaît la commande imbriquée', () => {
    expect(invokedSkillId('/arena /heal autowin os')).toBe('arena')
    expect(invokedSkillId('/heal autowin os')).toBe('heal')
  })
})
