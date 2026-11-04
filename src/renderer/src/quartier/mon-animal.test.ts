// @vitest-environment happy-dom
/**
 * L'ANIMAL DE MES AGENTS (conv-1537) : relu du réglage du poste, changé par les réglages de
 * l'Accueil, et jamais affiché quand il n'a pas pu être enregistré (les collègues ne le verraient pas).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abonnerMonAnimal,
  choisirMonAnimal,
  choixDeLAnimalDisponible,
  lireMonAnimal,
  reinitialiserMonAnimal
} from './mon-animal'

type Api = Record<string, unknown>
const poserApi = (api: Api | undefined): void => {
  ;(window as unknown as { api?: Api }).api = api
}
const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  reinitialiserMonAnimal()
  poserApi(undefined)
})

describe("l'animal de mes agents", () => {
  it('vaut le tanuki tant que le réglage n’est pas relu', () => {
    expect(lireMonAnimal()).toBe('tanuki')
  })

  it('relit le réglage du poste au premier abonné, et prévient la scène', async () => {
    const boardDossier = vi.fn(async () => ({ animal: 'renard' }))
    poserApi({ boardDossier })
    const vu = vi.fn()
    abonnerMonAnimal(vu)
    abonnerMonAnimal(() => undefined)
    await attendre()
    expect(boardDossier).toHaveBeenCalledTimes(1)
    expect(lireMonAnimal()).toBe('renard')
    expect(vu).toHaveBeenCalledTimes(1)
  })

  it('un animal inconnu dans le réglage vaut le tanuki', async () => {
    poserApi({ boardDossier: async () => ({ animal: '<script>' }) })
    abonnerMonAnimal(() => undefined)
    await attendre()
    expect(lireMonAnimal()).toBe('tanuki')
  })

  it('enregistre le choix sur le poste, et l’affiche une fois enregistré', async () => {
    const quartierPresenceAnimal = vi.fn(async (animal: unknown) => ({ animal }))
    poserApi({ quartierPresenceAnimal })
    expect(choixDeLAnimalDisponible()).toBe(true)
    await expect(choisirMonAnimal('renard')).resolves.toBe(true)
    expect(quartierPresenceAnimal).toHaveBeenCalledWith('renard')
    expect(lireMonAnimal()).toBe('renard')
  })

  it.each(['panda', 'panda-roux'] as const)(
    'relit et enregistre %s (conv-1546)',
    async (animal) => {
      const quartierPresenceAnimal = vi.fn(async (choix: unknown) => ({ animal: choix }))
      poserApi({ boardDossier: async () => ({ animal }), quartierPresenceAnimal })
      abonnerMonAnimal(() => undefined)
      await attendre()
      expect(lireMonAnimal()).toBe(animal)
      await expect(choisirMonAnimal(animal)).resolves.toBe(true)
      expect(quartierPresenceAnimal).toHaveBeenCalledWith(animal)
    }
  )

  it('un choix non enregistré ne change pas l’affichage', async () => {
    // Pont d'avant redémarrage : aucun canal pour enregistrer.
    poserApi({})
    expect(choixDeLAnimalDisponible()).toBe(false)
    await expect(choisirMonAnimal('renard')).resolves.toBe(false)
    expect(lireMonAnimal()).toBe('tanuki')
    // Le processus principal refuse : l'état rendu garde l'ancien animal.
    poserApi({
      quartierPresenceAnimal: async () => {
        throw new Error('partage injoignable')
      }
    })
    await expect(choisirMonAnimal('renard')).resolves.toBe(false)
    expect(lireMonAnimal()).toBe('tanuki')
  })
})
