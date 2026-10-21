import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { skillRoots } from './native-registry'
import { invokedSkillId, skillInstruction } from './skill-pipeline'

/**
 * `/gel` ET `/maj` (conv-1036) SONT-ELLES ATTEINTES PAR LE VRAI CHEMIN D'INVOCATION ?
 *
 * Même sonde que `arena-routable.test.ts` : le routage est générique, un grep sur le nom ne prouve
 * rien. Pour `/maj`, le message testé est CELUI que le bouton « Réparer la mise à jour » envoie
 * (UpdateBanner.tsx) : si ce message ne charge pas la skill, l'agent reçoit une raison de refus
 * sans aucune procédure, et la consigne qui protège main disparaît avec elle.
 */
describe('/maj — le message du bouton charge la procédure', () => {
  const messageDuBouton =
    "/maj La mise à jour d'Autowin est bloquée : « La mise à jour n'a pas pu s'appliquer ». " +
    'Résous le blocage puis relance la mise à jour.'

  it('reconnaît la skill en tête du message envoyé par le bouton', () => {
    expect(invokedSkillId(messageDuBouton)).toBe('maj')
  })

  it('charge le corps de maj, avec la voie sûre et sans le sélecteur', () => {
    const corps = skillInstruction('maj', skillRoots())
    expect(corps).toContain('=== SKILL MAJ (kit) ===')
    expect(corps).toContain('refs/heads/sauvegarde/')
    expect(corps).not.toContain('description:')
  })
})

describe('/gel — la skill et les outils qu elle cite existent', () => {
  it('charge le corps de gel depuis les racines réelles', () => {
    expect(invokedSkillId('/gel j ai eu un freeze en ouvrant knowledge')).toBe('gel')
    const corps = skillInstruction('gel', skillRoots())
    expect(corps).toContain('=== SKILL GEL (kit) ===')
    expect(corps).toContain('node scripts/gels-classement.mjs')
  })

  /*
   * Le critère de la piste (scout conv-1036) : un fil « /heal j'ai eu un freeze » commence par le
   * classement. `heal` doit donc, dans son corps CHARGÉ, renvoyer un gel d'Autowin vers `gel`.
   * Entrée qui rend ce test rouge : skills/heal/SKILL.md d'avant conv-1036 (72b473a2).
   */
  it('le corps chargé de heal envoie un gel d Autowin vers gel, à l étape de mesure', () => {
    const corps = skillInstruction('heal', skillRoots())
    expect(corps).toMatch(/Gel d'Autowin OS[^\n]*joue d'abord `gel`/)
    expect(corps).toContain('skills/gel/SKILL.md')
  })

  it('chaque script cité par la procédure est présent dans le dépôt', () => {
    const corps = skillInstruction('gel', skillRoots())
    const scripts = [...new Set(corps.match(/scripts\/[a-z-]+\.mjs/g) ?? [])]
    expect(scripts.length).toBeGreaterThanOrEqual(3)
    for (const s of scripts) expect(existsSync(join(process.cwd(), s)), s).toBe(true)
  })
})
