import { describe, expect, it } from 'vitest'
import { SLASH_COMMANDS, matchSlashCommands, skillSlashCommands } from './chat-view-model'
import { PIPELINE_PHASES } from '../../../main/skill-pipeline'
import { nativeSkills } from '../../../main/native-registry'

/**
 * Ce test gardait la DÉCOUVRABILITÉ du kit contre une liste écrite à la main dans le renderer. Il
 * constatait le risque sans pouvoir l'éliminer : la liste restait manuelle, donc une skill ajoutée
 * sur le disque restait invisible. C'est arrivé — `think` et `learn`, invocables mais absentes de la
 * palette, d'où « je sais même pas si elles sont actives » (2026-08-20).
 *
 * La palette dérive désormais de l'inventaire disque. Le test se branche donc sur la MÊME source que
 * l'application (`nativeSkills`), au lieu d'une liste que quelqu'un devait penser à mettre à jour.
 */
const palette = (): ReturnType<typeof skillSlashCommands> => skillSlashCommands(nativeSkills())
const noms = (): string[] => palette().map((command) => command.name)

describe('commandes slash — découvrabilité du kit', () => {
  it('chaque phase du pipeline est atteignable au clavier', () => {
    expect(PIPELINE_PHASES.filter((phase) => !noms().includes(phase))).toEqual([])
  })

  it('TOUTE skill présente sur disque est proposée — plus aucune liste à tenir à jour', () => {
    const surDisque = nativeSkills()
      .filter((skill) => skill.enabled !== false)
      .map((skill) => skill.id)
    expect(noms()).toEqual(expect.arrayContaining(surDisque))
  })

  it('`think` et `learn` sont trouvables — le cas exact qui manquait', () => {
    expect(noms()).toContain('think')
    expect(noms()).toContain('learn')
    expect(palette().find((c) => c.name === 'learn')?.insert).toBe('/learn ')
  })

  it('l’autocomplétion propose `remake` sur un préfixe partiel', () => {
    const items = matchSlashCommands('/rem', palette()).map((command) => command.name)
    expect(items).toContain('remake')
    expect(matchSlashCommands('/jud', palette()).map((c) => c.name)).not.toContain('remake')
  })

  it('chaque entrée porte un indice lisible : une entrée sans intention n’aide personne', () => {
    for (const command of palette()) {
      expect(command.hint.trim().length).toBeGreaterThan(0)
      expect(command.hint.trim()).not.toBe('Skill')
    }
  })

  it('aucun doublon entre commandes intégrées et skills', () => {
    const tous = matchSlashCommands('/', palette()).map((c) => c.name)
    expect(tous).toHaveLength(new Set(tous).size)
    expect(tous).toContain(SLASH_COMMANDS[0].name)
  })

  it('chaque entrée insère bien sa propre commande', () => {
    for (const command of [...SLASH_COMMANDS, ...palette()]) {
      expect(command.insert.startsWith(`/${command.name}`)).toBe(true)
    }
  })
})
