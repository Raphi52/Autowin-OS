import { describe, expect, it } from 'vitest'
import { SLASH_COMMANDS, matchSlashCommands } from './chat-view-model'
import { PIPELINE_PHASES } from '../../../main/skill-pipeline'

/**
 * La liste des commandes slash n'etait figee par AUCUN test (verifie le 2026-08-04). Elle est ecrite a
 * la main dans le renderer alors que les skills vivent dans le kit : rien ne signalait qu'une skill du
 * kit soit absente de l'autocompletion, ni qu'une phase du pipeline devienne inatteignable au clavier.
 *
 * A savoir pour lire ces tests : il n'existe AUCUN routage slash -> phase. Une entree ici est de
 * l'autocompletion — elle insere du texte dans le composeur. La substance vient du kit que le CLI
 * charge lui-meme (`~/.claude/skills/<nom>/SKILL.md`). Le test garde donc la DECOUVRABILITE, pas le
 * comportement : c'est precisement ce qui se perd en silence.
 */
const names = (): string[] => SLASH_COMMANDS.map((command) => command.name)

describe('commandes slash — découvrabilité du kit', () => {
  it('chaque phase du pipeline est atteignable au clavier', () => {
    const missing = PIPELINE_PHASES.filter((phase) => !names().includes(phase))
    expect(missing).toEqual([])
  })

  it('`/remake` est exposé — la skill existe dans le kit, elle doit être trouvable', () => {
    expect(names()).toContain('remake')
    const remake = SLASH_COMMANDS.find((command) => command.name === 'remake')
    // L'indice doit dire ce que ca FAIT : une entree sans intention lisible n'aide personne.
    expect(remake?.hint).toBeTruthy()
    expect(remake?.insert).toBe('/remake ')
  })

  it('l’autocomplétion propose `remake` sur un préfixe partiel', () => {
    expect(matchSlashCommands('/rem').map((command) => command.name)).toContain('remake')
    // Et ne le propose pas sur un prefixe qui ne le concerne pas.
    expect(matchSlashCommands('/jud').map((command) => command.name)).not.toContain('remake')
  })

  it('aucun doublon : deux entrées de même nom rendraient l’autocomplétion ambiguë', () => {
    expect(names()).toHaveLength(new Set(names()).size)
  })

  it('chaque entrée insère bien sa propre commande', () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.insert.startsWith(`/${command.name}`)).toBe(true)
    }
  })
})
