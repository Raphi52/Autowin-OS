import { describe, expect, it, vi } from 'vitest'
import { GuichetProd, type DemandeProdPubliee } from './prod-guichet'

function montage(options: { delaiMs?: number } = {}) {
  const publiees: DemandeProdPubliee[] = []
  const retirees: string[] = []
  let n = 0
  const guichet = new GuichetProd({
    notifier: (d) => publiees.push(d),
    retirer: (id) => retirees.push(id),
    identifiant: () => `d${++n}`,
    delaiMs: options.delaiMs ?? 50
  })
  return { guichet, publiees, retirees }
}

describe('GuichetProd', () => {
  it('publie la demande vers l’écran puis rend le jeton déposé', async () => {
    const { guichet, publiees, retirees } = montage()
    const attente = guichet.demander({
      cible: 'base:RIG_AMIENS',
      operation: 'sql-read',
      niveau: 'phrase' as const,
      raison: 'r'
    })
    expect(publiees).toEqual([
      {
        id: 'd1',
        cible: 'base:RIG_AMIENS',
        operation: 'sql-read',
        raison: 'r',
        niveau: 'phrase' as const
      }
    ])
    expect(guichet.deposer('d1', 'jeton-opaque')).toBe(true)
    await expect(attente).resolves.toEqual({ type: 'jeton', valeur: 'jeton-opaque' })
    expect(retirees).toEqual(['d1'])
    expect(guichet.enAttente()).toEqual([])
  })

  it('rend undefined quand l’utilisateur annule — le geste reste refusé', async () => {
    const { guichet } = montage()
    const attente = guichet.demander({
      cible: 'base:X',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    expect(guichet.annuler('d1')).toBe(true)
    await expect(attente).resolves.toBeUndefined()
  })

  it('abandonne après le délai : le silence n’autorise rien', async () => {
    const { guichet, retirees } = montage({ delaiMs: 5 })
    const attente = guichet.demander({
      cible: 'base:X',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    await expect(attente).resolves.toBeUndefined()
    expect(retirees).toEqual(['d1'])
    expect(guichet.deposer('d1', 'trop-tard')).toBe(false)
  })

  it('refuse un jeton vide et un identifiant inconnu', async () => {
    const { guichet } = montage()
    const attente = guichet.demander({
      cible: 'base:X',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    expect(guichet.deposer('d1', '')).toBe(false)
    expect(guichet.deposer('inconnu', 'jeton')).toBe(false)
    expect(guichet.deposer('d1', 'jeton')).toBe(true)
    await expect(attente).resolves.toEqual({ type: 'jeton', valeur: 'jeton' })
  })

  it('n’attend pas quand l’écran est injoignable', async () => {
    const guichet = new GuichetProd({
      notifier: () => {
        throw new Error('fenêtre fermée')
      },
      delaiMs: 60_000
    })
    await expect(
      guichet.demander({
        cible: 'base:X',
        operation: 'sql-read',
        raison: 'r',
        niveau: 'phrase' as const
      })
    ).resolves.toBeUndefined()
  })

  it('expose les demandes ouvertes pour un écran qui se recharge', async () => {
    const { guichet } = montage()
    const attente = guichet.demander({
      cible: 'base:Y',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    expect(guichet.enAttente()).toEqual([
      { id: 'd1', cible: 'base:Y', operation: 'sql-read', raison: 'r', niveau: 'phrase' as const }
    ])
    guichet.annuler('d1')
    await attente
  })

  it('tient plusieurs demandes simultanées sans les mélanger', async () => {
    const { guichet } = montage()
    const a = guichet.demander({
      cible: 'base:A',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    const b = guichet.demander({
      cible: 'base:B',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    guichet.deposer('d2', 'jeton-b')
    guichet.deposer('d1', 'jeton-a')
    expect(await a).toEqual({ type: 'jeton', valeur: 'jeton-a' })
    expect(await b).toEqual({ type: 'jeton', valeur: 'jeton-b' })
  })
})

describe('bruit', () => {
  it('ne laisse aucun minuteur pendant après résolution', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const { guichet } = montage()
    const attente = guichet.demander({
      cible: 'base:Z',
      operation: 'sql-read',
      raison: 'r',
      niveau: 'phrase' as const
    })
    guichet.deposer('d1', 'j')
    await attente
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})
