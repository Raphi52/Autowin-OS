import { describe, expect, it } from 'vitest'
import {
  creerCalculateurDeCarte,
  type ConversationPourLaCarte,
  type MessageStockePourLaCarte,
  type RunPourLaCarte
} from './carte-des-besoins'
import { etatVide } from './liens-work-items'

/**
 * LE CALCUL DU BOARD, ÉTAPE PAR ÉTAPE (conv-1248, 2026-10-29).
 *
 * Mesure dans l'app réelle après le calcul d'avance : 165 à 218 ms par ouverture, dont la lecture
 * des runs — 111 ms en médiane (`snapshot:runs` de `turn-timing.jsonl`, 300 tours). Elle partait
 * APRÈS les fils, et seul le total (`dureeMs`) se voyait : impossible de dire où partait le temps
 * dans l'app sans la redémarrer. Deux exigences :
 * - la lecture des runs (du disque, donc de l'attente) part AVANT le calcul des fils et des
 *   identités, et se recouvre avec eux ;
 * - chaque étape rend sa durée (`etapesMs`), lisible depuis la vue sans rien instrumenter.
 */

const user = (content: string, ts: number): MessageStockePourLaCarte =>
  ({ role: 'user', content, ts, messageId: `u${ts}` }) as MessageStockePourLaCarte

const fil = (id: string, ts: number): ConversationPourLaCarte & { updatedAt: number } => ({
  id,
  title: `Titre ${id}`,
  messages: [user(`demande ${id}`, ts)],
  updatedAt: ts
})

describe('calcul du Board — la lecture des runs se recouvre avec le reste', () => {
  it('la lecture des runs part avant le calcul du premier fil', async () => {
    const ordre: string[] = []
    const { calculer } = creerCalculateurDeCarte({
      lireConversations: () => [fil('a', 1_000), fil('b', 2_000)],
      lireRuns: async () => {
        ordre.push('runs')
        return [] as RunPourLaCarte[]
      },
      calculerDemandes: (c) => {
        ordre.push(`fil ${c.id}`)
        return []
      },
      ceder: async () => undefined
    })
    await calculer()
    expect(ordre).toEqual(['runs', 'fil a', 'fil b'])
  })

  it('chaque étape rend sa durée, et le total est plus court que leur somme', async () => {
    // Horloge factice : chaque étape avance le temps d'une durée connue.
    let t = 0
    const { calculer } = creerCalculateurDeCarte({
      lireConversations: () => [fil('a', 1_000), fil('b', 2_000)],
      // 30 ms de disque, pendant lesquels le reste du calcul avance.
      lireRuns: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            t = Math.max(t, 30)
            resolve([])
          }, 5)
        ),
      calculerDemandes: () => {
        t += 10
        return []
      },
      lireJournal: () => {
        t += 3
        return new Map()
      },
      lireLiens: () => {
        t += 2
        return etatVide()
      },
      ceder: async () => undefined,
      maintenant: () => t
    })
    const carte = await calculer()
    expect(carte.etapesMs).toMatchObject({ fils: 20, journal: 3, liens: 2, runs: 30 })
    expect(carte.etapesMs).toHaveProperty('identites')
    expect(carte.etapesMs).toHaveProperty('assemblage')
    // Recouvrement : 30 ms de runs ET 25 ms du reste tiennent en 30 ms, pas en 55.
    expect(carte.dureeMs).toBe(30)
  })

  it('une lecture des runs en échec fait encore échouer le calcul, sans rejet orphelin', async () => {
    const { calculer } = creerCalculateurDeCarte({
      lireConversations: () => [fil('a', 1_000)],
      lireRuns: () => Promise.reject(new Error('disque injoignable')),
      ceder: async () => undefined
    })
    await expect(calculer()).rejects.toThrow('disque injoignable')
  })
})
