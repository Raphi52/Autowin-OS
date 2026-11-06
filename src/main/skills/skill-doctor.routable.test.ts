import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { skillRoots } from '../app/native-registry'
import { invokedSkillId, noteSkillInconnue, skillInstruction } from './skill-pipeline'

/**
 * `/doctor` EST-ELLE ATTEINTE PAR LE VRAI CHEMIN D'INVOCATION ?
 *
 * Même sonde que `skills-gel-maj.routables.test.ts` : le routage est générique, un grep sur le nom
 * ne prouverait rien. `/checkup` doit charger le même corps, comme dans Claude Code.
 */
describe('/doctor — le message tapé charge la procédure', () => {
  it('reconnaît la skill en tête du message et charge son corps, sans le sélecteur', () => {
    expect(invokedSkillId('/doctor prompt-audit AGENTS.md')).toBe('doctor')
    const corps = skillInstruction('doctor', skillRoots())
    expect(corps).toContain('=== SKILL DOCTOR (kit) ===')
    expect(corps).toContain('node scripts/doctor.mjs --json')
    expect(corps).not.toContain('description:')
  })

  it('/checkup charge le même corps et ne se signale pas comme inconnue', () => {
    expect(noteSkillInconnue('checkup', skillRoots())).toBeUndefined()
    expect(skillInstruction('checkup', skillRoots())).toBe(skillInstruction('doctor', skillRoots()))
  })

  it('le corps tient le contrat de Claude Code : constats d’abord, réparation après accord', () => {
    const corps = skillInstruction('doctor', skillRoots())
    expect(corps).toContain('Avant tout changement')
    expect(corps).toContain('Ne répare rien avant le choix de l')
    expect(corps).toContain('/doctor prompt-audit [chemin]')
  })

  it('chaque fichier du dépôt cité par la procédure existe', () => {
    const corps = skillInstruction('doctor', skillRoots())
    const cites = [...new Set(corps.match(/(?:scripts|src)\/[\w./-]+\.(?:mjs|ts)/g) ?? [])]
    expect(cites.length).toBeGreaterThanOrEqual(5)
    for (const fichier of cites)
      expect(existsSync(join(process.cwd(), fichier)), fichier).toBe(true)
  })
})
