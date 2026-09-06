import { describe, expect, it } from 'vitest'
import { skillRoots } from './native-registry'
import { skillInstruction } from './skill-pipeline'
import { enteteCibleManquante, lireCibleScout } from './scout-cible'

/**
 * CONTRAT DE TEXTE VÉRIFIÉ PAR SONDE, pas par relecture.
 *
 * Constat du 2026-09-06 : le mode auto lit une ligne `CIBLE:` dans la sortie du scout pour porter
 * la piste retenue à l'étape suivante, et `scout-cible.ts` doit injecter un rappel quand elle
 * manque — alors que la skill `scout` ne la réclamait NULLE PART. Le format sur lequel repose
 * l'enchaînement n'était donc pas une sortie garantie. Sans ce test, un futur remaniement de
 * `skills/scout/SKILL.md` efface l'exigence sans rien casser de visible.
 */
function corpsSkill(id: string): string {
  const injecte = skillInstruction(id, skillRoots())
  expect(injecte).not.toBe('')
  return injecte
}

describe('la skill scout exige la ligne CIBLE: en sortie', () => {
  const scout = corpsSkill('scout')

  it('réclame explicitement une ligne CIBLE: obligatoire', () => {
    expect(scout).toMatch(/CIBLE:/)
    expect(scout).toMatch(/MANDATORY closing line/i)
  })

  it('donne les deux formes que le lecteur machine sait interpréter', () => {
    // La piste engagée, et le cas « aucune piste défendable » — sans lui, la fin de chaîne
    // ne serait pas exprimable et le scout inventerait une cible pour satisfaire le format.
    expect(scout).toContain('CIBLE: <the row you engage>')
    expect(scout).toContain('CIBLE: aucune')
  })

  it('interdit une seconde ligne CIBLE:, comme le fait le code qui la lit', () => {
    expect(scout).toMatch(/Exactly ONE `CIBLE:` line/i)
  })

  it('dit que la ligne est lue par la machine, pas seulement par un humain', () => {
    expect(scout).toMatch(/READ BY MACHINE/i)
    expect(scout).toContain('scout-cible.ts')
  })

  it('produit une sortie que le lecteur réel accepte, et qui ne déclenche aucun rappel', () => {
    // Preuve de bout en bout : la forme ENSEIGNÉE par la skill est bien celle que le code lit.
    const sortie = '| 1 | 82 | 🔧 fix | x | y | z |\n\nCIBLE: la piste 1 — POURQUOI: impact le plus fort'
    // `scout-cible` rend la ligne ENTIÈRE : le retrait du `— POURQUOI: …` appartient au lecteur
    // du mode auto (`chat-auto-mode.ts`), pas à cette sonde. Ce qui compte ici : la piste est vue.
    expect(lireCibleScout(sortie)).toContain('la piste 1')
    expect(enteteCibleManquante(sortie)).toBeUndefined()
  })

  it('signale la sortie SANS ligne CIBLE:, celle que la skill interdit désormais', () => {
    const sansCible = '| 1 | 82 | 🔧 fix | x | y | z |'
    expect(lireCibleScout(sansCible)).toBeFalsy()
    expect(enteteCibleManquante(sansCible)).toMatch(/CIBLE:/)
  })
})
