import { describe, expect, it } from 'vitest'
import { contextGauge, CONTEXT_WINDOWS } from './context-gauge'

/**
 * LA JAUGE DE CONTEXTE — combien de la fenetre du modele ce fil occupe-t-il DEJA.
 *
 * Autowin mesurait finement ce que le contexte avait COUTE (cache-read, fresh, ledger, Observatory)
 * et ne disait nulle part ce qu'il PORTAIT. Un fil pouvait s'approcher de la saturation sans qu'un
 * seul ecran ne l'indique ; la seule reponse a la saturation etait une troncature brute des 40
 * derniers messages, muette (`chat-turn-messages.ts:62`).
 *
 * NUMERATEUR : `inputTokens` du DERNIER tour. C'est exactement ce que le modele vient de recevoir,
 * donc l'occupation reelle -- pas une somme des tours, qui compterait N fois le meme prefixe.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CES TESTS SI LA JAUGE MENT : un modele dont la fenetre n'est pas
 * connue doit rendre `undefined`, JAMAIS un pourcentage sur une taille supposee. Une jauge fausse
 * est pire qu'une jauge absente -- elle est crue.
 */
describe('jauge de contexte', () => {
  it('rend la part occupee de la fenetre du modele', () => {
    const jauge = contextGauge({ inputTokens: 100_000, model: 'claude-opus-5' })
    expect(jauge?.limit).toBe(200_000)
    expect(jauge?.used).toBe(100_000)
    expect(jauge?.ratio).toBeCloseTo(0.5)
  })

  it('ne rend RIEN pour un modele dont la fenetre est inconnue', () => {
    // Pas de source citable pour ce modele : l'absence est la reponse honnete.
    expect(contextGauge({ inputTokens: 100_000, model: 'un-modele-jamais-vu' })).toBeUndefined()
    expect(contextGauge({ inputTokens: 100_000 })).toBeUndefined()
  })

  it('ne rend rien sans mesure d entree plutot qu une jauge a zero', () => {
    // Une jauge a 0 % se lit « le fil est vide », alors qu'on ne SAIT pas. Ce n'est pas pareil.
    expect(contextGauge({ model: 'claude-opus-5' })).toBeUndefined()
  })

  it('nomme trois paliers, pour que la couleur ne soit pas decidee dans la vue', () => {
    expect(contextGauge({ inputTokens: 20_000, model: 'claude-opus-5' })?.level).toBe('ok')
    expect(contextGauge({ inputTokens: 140_000, model: 'claude-opus-5' })?.level).toBe('tendu')
    expect(contextGauge({ inputTokens: 190_000, model: 'claude-opus-5' })?.level).toBe('critique')
  })

  it('borne a 1 un depassement plutot que d afficher 130 %', () => {
    const jauge = contextGauge({ inputTokens: 260_000, model: 'claude-opus-5' })
    expect(jauge?.ratio).toBe(1)
    expect(jauge?.level).toBe('critique')
    // Le depassement reste LISIBLE : borner l'affichage ne doit pas effacer le fait.
    expect(jauge?.used).toBe(260_000)
  })

  it('distingue le contexte RELU du cache de ce qui a ete paye plein tarif', () => {
    const jauge = contextGauge({
      inputTokens: 100_000,
      cacheReadTokens: 90_000,
      model: 'claude-opus-5'
    })
    expect(jauge?.cacheRead).toBe(90_000)
    expect(jauge?.fresh).toBe(10_000)
  })

  it('ne declare que des fenetres dont la source est citable', () => {
    for (const fenetre of CONTEXT_WINDOWS) {
      expect(fenetre.tokens).toBeGreaterThan(0)
      expect(fenetre.source.length).toBeGreaterThan(0)
    }
  })
})
