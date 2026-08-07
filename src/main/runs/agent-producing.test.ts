import { describe, expect, it } from 'vitest'
import { runIsProducing, SILENCE_TOLERE_MS } from './run-reattach'

/**
 * Ce que ces tests protègent : que l'app cesse d'affirmer « l'agent travaille encore » sans l'avoir
 * vérifié.
 *
 * `runLiveness` répond « ce processus existe », ce qui n'est PAS « cet agent produit ». Un CLI bloqué
 * sur un appel qui ne revient jamais garde son processus vivant : le run était rattaché
 * indéfiniment, aucune échéance ne le dépinglait, et le chat attendait une réponse qui n'arrivait
 * pas. Le journal est le seul témoin de production qu'on ait sur disque.
 */
const MAINTENANT = 1_000_000_000
const agent = (token: string, journalPath?: string): { token: string; journalPath?: string } => ({
  token,
  ...(journalPath ? { journalPath } : {})
})

describe('produire n’est pas exister', () => {
  it('un journal qui vient de bouger = l’agent produit', () => {
    const etat = { agents: [agent('a', '/j/a.jsonl')] }
    expect(runIsProducing(etat, MAINTENANT, () => MAINTENANT - 1_000)).toBe(true)
  })

  it('un journal muet au-delà du seuil = l’agent NE produit plus', () => {
    // Le cas vécu : processus vivant, plus une ligne écrite depuis une heure.
    const etat = { agents: [agent('a', '/j/a.jsonl')] }
    expect(runIsProducing(etat, MAINTENANT, () => MAINTENANT - 60 * 60_000)).toBe(false)
  })

  it('un seul agent encore actif suffit à dire que le run produit', () => {
    const etat = { agents: [agent('mort', '/j/a.jsonl'), agent('actif', '/j/b.jsonl')] }
    const dates: Record<string, number> = {
      '/j/a.jsonl': MAINTENANT - 60 * 60_000,
      '/j/b.jsonl': MAINTENANT - 5_000
    }
    expect(runIsProducing(etat, MAINTENANT, (p) => dates[p])).toBe(true)
  })

  it('la frontière du seuil ne bascule pas à l’envers', () => {
    const etat = { agents: [agent('a', '/j/a.jsonl')] }
    const juste_avant = MAINTENANT - (SILENCE_TOLERE_MS - 1)
    const juste_apres = MAINTENANT - SILENCE_TOLERE_MS
    expect(runIsProducing(etat, MAINTENANT, () => juste_avant)).toBe(true)
    expect(runIsProducing(etat, MAINTENANT, () => juste_apres)).toBe(false)
  })

  it('sans journal, on n’affirme PAS un arrêt — comportement historique conservé', () => {
    expect(runIsProducing({ agents: [agent('a')] }, MAINTENANT, () => undefined)).toBe(true)
    expect(runIsProducing({ agents: [] }, MAINTENANT, () => undefined)).toBe(true)
    expect(runIsProducing(undefined, MAINTENANT, () => undefined)).toBe(true)
  })

  it('une sonde qui échoue vaut « on ne sait pas », jamais « arrêté »', () => {
    const etat = { agents: [agent('a', '/j/a.jsonl')] }
    expect(
      runIsProducing(etat, MAINTENANT, () => {
        throw new Error('disque indisponible')
      })
    ).toBe(true)
  })
})
