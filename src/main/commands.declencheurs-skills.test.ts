import { describe, expect, it } from 'vitest'
import { ligneDeSkill, skillsInvocables } from './commands'
import { nativeSkills } from './native-registry'

/**
 * DECLENCHEUR, pas seulement NOM.
 *
 * Un nom nu (`forge`) ne dit pas QUAND s'en servir : la skill ne pouvait donc partir que si
 * l'utilisateur tapait le slash. Chaque SKILL.md porte deja son declencheur dans son front-matter
 * `description` ; ce test verifie que cette phrase arrive bien dans le snapshot du tour.
 */
describe('skillsInvocables — declencheur remis au modele', () => {
  it('accole a chaque skill le debut de sa description', () => {
    const lignes = skillsInvocables()
    const forge = lignes.find((l) => l.startsWith('forge'))
    expect(forge, 'skill forge absente du disque').toBeDefined()
    expect(forge).toContain(' — ')
    expect(forge!.toLowerCase()).toContain('outil')
  })

  it('borne chaque ligne : le declencheur, jamais le contrat entier', () => {
    for (const ligne of skillsInvocables()) {
      expect(ligne.length).toBeLessThanOrEqual(280)
      expect(ligne).not.toContain('\n')
    }
  })

  it('retombe sur le nom nu quand la description est absente', () => {
    const sansPhrase = nativeSkills().filter((s) => s.description === 'Skill (SKILL.md)')
    for (const s of sansPhrase) {
      expect(skillsInvocables()).toContain(s.id)
    }
  })
})

/**
 * FRONTIERE, pas seulement DECLENCHEUR (conv-1033, 2026-10-21).
 *
 * `kit-cliquets.test.ts` exige que chaque description dise ce pour quoi la skill ne sert PAS, pour
 * qu'elle ne soit pas choisie a la place d'une voisine (heal qui CORRIGE pour un audit de `judge`).
 * Mesure sur le kit : les 23 clauses commencent toutes APRES le 120e caractere (de 275 a 814) —
 * la coupe de `skillsInvocables` les retirait toutes, donc le choix d'une skill depuis le chat ne
 * voyait jamais la frontiere que le cliquet impose d'ecrire.
 */
describe('skillsInvocables — la frontiere survit a la coupe', () => {
  const CLAUSE = /PAS pour|NE PAS utiliser|Ne pas utiliser|NE PAS l'utiliser|PAS l'utiliser/u

  it('chaque skill dont la description porte une clause la garde dans sa ligne', () => {
    const lignes = skillsInvocables()
    const perdues = nativeSkills()
      .filter((s) => s.enabled && CLAUSE.test(s.description ?? ''))
      .map((s) => s.id)
      .filter((id) => !CLAUSE.test(lignes.find((l) => l.startsWith(`${id} — `)) ?? ''))
    expect(perdues).toEqual([])
  })

  it('accole la clause apres un declencheur coupe, bornee, sans la repeter', () => {
    const declencheur = `Trouve et corrige les défauts. ${'x'.repeat(300)}`
    const ligne = ligneDeSkill(
      'heal',
      `${declencheur} PAS pour : auditer sans corriger → \`judge\` · choisir une fonctionnalité → \`scout\` · ${'y'.repeat(200)}. Phrase suivante sans rapport.`
    )
    expect(ligne.startsWith('heal — Trouve et corrige les défauts.')).toBe(true)
    expect(ligne).toContain('PAS pour : auditer sans corriger → `judge`')
    expect(ligne).not.toContain('Phrase suivante')
    expect(ligne.match(/PAS pour/gu)).toHaveLength(1)
    expect(ligne.length).toBeLessThanOrEqual(280)
  })

  it('coupe la clause a la fin de sa phrase quand elle tient', () => {
    const ligne = ligneDeSkill(
      'forge',
      `${'a'.repeat(200)} NE PAS utiliser pour : réparer un outil cassé (→ \`heal\`). forge construit UNE capacité.`
    )
    expect(ligne.endsWith('NE PAS utiliser pour : réparer un outil cassé (→ `heal`).')).toBe(true)
  })

  it('ne change rien a une description courte sans clause', () => {
    expect(ligneDeSkill('look', 'Convertit ce qui est affiché.')).toBe(
      'look — Convertit ce qui est affiché.'
    )
  })
})
