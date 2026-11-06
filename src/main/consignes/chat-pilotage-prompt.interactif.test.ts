import { describe, expect, it } from 'vitest'
import { SKILL_MISE_EN_FORME, buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { chargerSkillPourLeModele } from '../commands/skill-charger-command'

/**
 * Une capacite que le prompt ne nomme pas reste morte — verifie pour l'interactif sans script.
 * La consigne servie a chaque tour en garde le principe (`:checked`, onglets sans script) ; la
 * liste complete des controles acceptes vit dans la skill mise-en-forme, rendue par `skill_charger`.
 */
describe('contrat de l interactif sans JavaScript', () => {
  it('nomme le principe dans la consigne servie à chaque tour', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('INTERACTIF SANS JAVASCRIPT')
    expect(prompt).toContain('<details>/<summary>')
    expect(prompt).toContain(':checked')
  })

  it('apprend les cases a cocher, les libelles et les jauges, et rappelle la limite', () => {
    const detail = chargerSkillPourLeModele({ nom: SKILL_MISE_EN_FORME }).procedure
    expect(detail).toContain('INTERACTIF SANS JAVASCRIPT')
    expect(detail).toContain('type="checkbox"')
    expect(detail).toContain('<label for>')
    expect(detail).toContain('<progress>')
    expect(detail).toContain('<meter>')
    expect(detail).toContain(':checked')
    // La limite reste dite : rien ne se saisit et rien ne s'envoie.
    expect(detail).toMatch(/Aucun autre champ n'est accepte/u)
  })
})
