import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from '../commands/commands'

/**
 * LE CHAMP `clesDuCoffre` DE L'ÉTAT ne porte que des noms. Sans une ligne qui dit quoi en faire,
 * l'agent ne sait ni que ces clés sont déjà dans l'environnement de ses commandes, ni qu'il s'en
 * sert par leur nom. La règle elle-même (valeur jamais recopiée, clé absente → réglage) vit dans
 * la constitution : la consigne du chat ne la répète pas.
 */
describe('paragraphe COFFRE de la consigne du chat', () => {
  const prompt = buildChatPilotagePrompt(CATALOG)
  const debut = prompt.indexOf('COFFRE À CLÉS')
  const paragraphe = debut < 0 ? '' : prompt.slice(debut, prompt.indexOf('\n', debut))

  it("explique clesDuCoffre et l'usage par le nom", () => {
    expect(paragraphe).toContain('clesDuCoffre')
    // Forme courte imposée par le plafond de la consigne du chat (marge de 71 caractères) : le sens
    // reste « ces noms sont des variables d'environnement ».
    expect(paragraphe).toContain("variables d'env")
    expect(paragraphe).toContain('$NOM')
    expect(paragraphe).toContain('$env:NOM')
  })

  it('ne répète pas la constitution', () => {
    expect(paragraphe).not.toContain('Réglages > Clés')
    expect(paragraphe).not.toContain('ne se recopie jamais')
    expect(paragraphe.length).toBeLessThan(600)
  })
})
