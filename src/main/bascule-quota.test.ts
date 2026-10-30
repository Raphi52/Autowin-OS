import { describe, expect, it, vi } from 'vitest'
import {
  SEUIL_BASCULE_POURCENT,
  basculerAvantLancement,
  compteAvecMarge,
  utilisationDuCompte
} from './bascule-quota'

/**
 * BASCULER AVANT DE LANCER, PAS APRÈS LE REFUS (conv-1069, 2026-10-22).
 *
 * Cas réel conv-1065 : cinq tours Opus partis en parallèle ont épuisé la session du compte actif
 * entre 11:01 et 11:04, alors qu'un autre compte avait de la marge. La rotation du registre ne
 * jouait qu'APRÈS le refus. Choix de l'utilisateur : « rien plafonner, juste basculer ».
 */

const mesures =
  (table: Record<string, number | undefined>) =>
  async (id: string): Promise<number | undefined> =>
    table[id]

describe('utilisation d’un compte', () => {
  it('prend la fenêtre la plus chargée : un 7 j presque plein mure aussi sûrement qu’un 5 h', () => {
    expect(
      utilisationDuCompte([
        { id: 'five-hour', label: '5 h', usedPercent: 20, remainingPercent: 80 },
        { id: 'seven-day', label: '7 j', usedPercent: 91, remainingPercent: 9 }
      ])
    ).toBe(91)
  })

  it('ignore une mesure sans plafond connu (tokens locaux) : pas de pourcentage inventé', () => {
    expect(
      utilisationDuCompte([
        { id: 'local-5h', label: '5 h', usedPercent: 0, remainingPercent: 100, limitKnown: false }
      ])
    ).toBeUndefined()
    expect(utilisationDuCompte([])).toBeUndefined()
  })
})

describe('choix du compte avant lancement', () => {
  it('le seuil est 100 % : on vide un compte avant d’en changer (conv-1328)', () => {
    expect(SEUIL_BASCULE_POURCENT).toBe(100)
  })

  it('compte actif vidé (100 %) et un autre à 30 % : bascule sur l’autre', async () => {
    const cible = await compteAvecMarge({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer: mesures({ default: 100, 'compte-2': 30 })
    })
    expect(cible).toBe('compte-2')
  })

  it('compte actif à 99 %, pas encore vidé : ne bascule pas, et ne sonde même pas les autres', async () => {
    const mesurer = vi.fn(mesures({ default: 99, 'compte-2': 5 }))
    const cible = await compteAvecMarge({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer
    })
    expect(cible).toBeUndefined()
    expect(mesurer).toHaveBeenCalledTimes(1)
    expect(mesurer).toHaveBeenCalledWith('default')
  })

  it('un seul compte : aucune sonde, aucun coût ajouté', async () => {
    const mesurer = vi.fn(mesures({ default: 99 }))
    expect(await compteAvecMarge({ actifId: 'default', comptes: ['default'], mesurer })).toBe(
      undefined
    )
    expect(mesurer).not.toHaveBeenCalled()
  })

  it('tous les comptes vidés : reste sur l’actif — rien n’est mis en attente', async () => {
    const cible = await compteAvecMarge({
      actifId: 'default',
      comptes: ['default', 'compte-2', 'compte-3'],
      mesurer: mesures({ default: 100, 'compte-2': 100, 'compte-3': 100 })
    })
    expect(cible).toBeUndefined()
  })

  it('choisit le compte qui a le PLUS de marge, pas le premier sous le seuil', async () => {
    const cible = await compteAvecMarge({
      actifId: 'compte-2',
      comptes: ['default', 'compte-2', 'compte-3'],
      mesurer: mesures({ default: 70, 'compte-2': 100, 'compte-3': 10 })
    })
    expect(cible).toBe('compte-3')
  })

  it('ne bascule jamais vers un compte dont le quota est inconnu (non connecté, sonde en échec)', async () => {
    const cible = await compteAvecMarge({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer: async (id) => {
        if (id === 'compte-2') throw new Error('Session Claude indisponible')
        return 100
      }
    })
    expect(cible).toBeUndefined()
  })

  it('quota de l’actif inconnu : ne bascule pas à l’aveugle', async () => {
    const cible = await compteAvecMarge({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer: mesures({ default: undefined, 'compte-2': 0 })
    })
    expect(cible).toBeUndefined()
  })
})

describe('bascule avant lancement', () => {
  it('bascule le compte actif quand il est vidé', async () => {
    const basculer = vi.fn()
    const cible = await basculerAvantLancement({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer: mesures({ default: 100, 'compte-2': 12 }),
      actifCourant: () => 'default',
      basculer
    })
    expect(cible).toBe('compte-2')
    expect(basculer).toHaveBeenCalledWith('compte-2')
  })

  it('un autre appel a déjà changé de compte entre-temps : n’écrase pas son choix', async () => {
    const basculer = vi.fn()
    const cible = await basculerAvantLancement({
      actifId: 'default',
      comptes: ['default', 'compte-2', 'compte-3'],
      mesurer: mesures({ default: 100, 'compte-2': 12, 'compte-3': 40 }),
      actifCourant: () => 'compte-3',
      basculer
    })
    expect(cible).toBeUndefined()
    expect(basculer).not.toHaveBeenCalled()
  })

  it('une sonde trop lente ne retient pas le lancement : l’appel part sur le compte actif', async () => {
    const basculer = vi.fn()
    const debut = Date.now()
    const cible = await basculerAvantLancement({
      actifId: 'default',
      comptes: ['default', 'compte-2'],
      mesurer: () => new Promise<number | undefined>(() => undefined),
      actifCourant: () => 'default',
      basculer,
      budgetMs: 30
    })
    expect(cible).toBeUndefined()
    expect(basculer).not.toHaveBeenCalled()
    expect(Date.now() - debut).toBeLessThan(1_000)
  })
})
