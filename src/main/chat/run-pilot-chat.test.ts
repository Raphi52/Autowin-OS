import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { annoncerFinDeTour, verdictVeilleurInactivite } from './run-pilot-chat'

/*
 * conv-1069, candidat 3 : une règle `task_create` « quand le tour de conv-N est terminé » attend un
 * événement que personne n'émettait. L'entrée qui ferait échouer ces tests si la correction était
 * fausse : un tour qui finit sans rien annoncer, ou qui l'annonce AVANT de quitter les tours actifs
 * (l'agent réveillé lirait alors « il tourne encore » avec `pilotChatActive`).
 */
describe('annoncerFinDeTour', () => {
  it('annonce la fin du tour, avec son fil et son identifiant', () => {
    const notifyAppEvent = vi.fn(async () => {})
    annoncerFinDeTour({ notifyAppEvent }, 'conv-1065', 'tour-42')
    expect(notifyAppEvent).toHaveBeenCalledTimes(1)
    const [evenement, contexte, fil] = notifyAppEvent.mock.calls[0] as unknown as string[]
    expect(evenement).toBe('chat-turn-done')
    expect(fil).toBe('conv-1065')
    // L'identifiant du tour distingue deux fins successives (sinon l'anti-rafale les fusionne).
    expect(contexte).toContain('tour-42')
    expect(contexte).toContain('conv-1065')
  })
  it('sans moteur de réveil ou s’il échoue, le tour se ferme quand même', async () => {
    expect(() => annoncerFinDeTour(undefined, 'conv-1065', 'tour-42')).not.toThrow()
    const echec = vi.fn(async () => {
      throw new Error('moteur indisponible')
    })
    expect(() => annoncerFinDeTour({ notifyAppEvent: echec }, 'conv-1065', 'tour-42')).not.toThrow()
    await Promise.resolve()
    expect(echec).toHaveBeenCalledTimes(1)
  })
  it('est appelé dans le `finally` du tour, APRÈS sa sortie des tours actifs', () => {
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    const fin = source.slice(source.indexOf('    } finally {\n      tourClos = true'))
    const sortie = fin.indexOf('activeChatTurns.delete(conversationId, controller)')
    const annonce = fin.indexOf('annoncerFinDeTour(deps.watchdogEngine(), conversationId, turnId)')
    expect(sortie).toBeGreaterThan(0)
    expect(annonce).toBeGreaterThan(sortie)
  })
})

describe('verdictVeilleurInactivite', () => {
  it('patiente tant que le plafond n est pas atteint', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 999, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('patienter')
  })
  it('coupe quand le plafond est atteint sans commande en vol', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 1000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
  })
  it('signale une commande en vol meme au-dela du plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 1, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
  it('signale une commande en vol meme sous le plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 0, commandesEnVol: 2, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
})
