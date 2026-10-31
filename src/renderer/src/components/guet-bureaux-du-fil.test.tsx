// @vitest-environment happy-dom
/**
 * LE GUET QUI OUVRE LE PANNEAU DES BUREAUX CACHÉS (conv-1378, 2026-10-31).
 *
 * Entrées qui doivent faire échouer ce fichier : un panneau qui revient seul sur un bureau déjà vu, un
 * bureau d'avant l'ouverture de l'app pris pour un lancement, une relance dans le même bureau ignorée,
 * une liste redemandée plus vite que 5 s (conv-1077 : 120,2 s figées), une liste en échec sans attente.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BureauTv } from '../../../main/hdesk-tv'
import {
  filsDuPanneau,
  useGuetBureauxDuFil,
  type GuetBureauxApi,
  type OptionsGuet
} from './guet-bureaux-du-fil'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEPUIS = Date.parse('2026-10-31T09:00:00+01:00')
const lance = (id: string, heure = '09:10:00'): BureauTv => ({
  id,
  travail: id,
  conversationId: 'conv-1',
  lanceLe: `2026-10-31T${heure}+01:00`
})

function Temoin(props: OptionsGuet): null {
  useGuetBureauxDuFil(props)
  return null
}

describe('useGuetBureauxDuFil', () => {
  let racine: Root | null = null
  let liste: BureauTv[] = []
  const rappel = vi.fn()
  let api: GuetBureauxApi & { hdeskTvBureaux: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    liste = []
    rappel.mockClear()
    api = { hdeskTvBureaux: vi.fn(async () => liste) }
  })

  afterEach(async () => {
    await act(async () => racine?.unmount())
    racine = null
    vi.useRealTimers()
  })

  async function rendre(props: Partial<OptionsGuet> = {}): Promise<void> {
    racine ??= createRoot(document.createElement('div'))
    await act(async () => {
      racine!.render(
        createElement(Temoin, {
          actif: true,
          fils: ['conv-1'],
          onBureauLance: rappel,
          api,
          depuis: DEPUIS,
          ...props
        })
      )
    })
  }

  const attendre = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('un bureau lancé par le fil est annoncé, une seule fois', async () => {
    await rendre()
    expect(rappel).not.toHaveBeenCalled()
    liste = [lance('a')]
    await attendre(5000)
    expect(rappel).toHaveBeenCalledTimes(1)
    expect(rappel).toHaveBeenCalledWith(liste[0], 'conv-1')
    await attendre(20000)
    expect(rappel).toHaveBeenCalledTimes(1)
  })

  it('un panneau refermé ne revient pas après un remontage, mais revient pour un autre bureau', async () => {
    liste = [lance('a')]
    await rendre()
    expect(rappel).toHaveBeenCalledTimes(1)
    await act(async () => racine!.unmount())
    racine = null
    await rendre()
    await attendre(5000)
    expect(rappel).toHaveBeenCalledTimes(1)
    liste = [lance('b', '09:20:00'), lance('a')]
    await attendre(5000)
    expect(rappel).toHaveBeenCalledTimes(2)
    expect(rappel.mock.lastCall?.[0].id).toBe('b')
  })

  it('une relance dans le même bureau compte comme un nouveau lancement', async () => {
    liste = [lance('a')]
    await rendre()
    liste = [lance('a', '09:30:00')]
    await attendre(5000)
    expect(rappel).toHaveBeenCalledTimes(2)
  })

  it('plusieurs lancements d’un coup : le plus récent, celui que la liste donne en tête', async () => {
    liste = [lance('recent', '09:20:00'), lance('ancien')]
    await rendre()
    expect(rappel).toHaveBeenCalledTimes(1)
    expect(rappel.mock.lastCall?.[0].id).toBe('recent')
  })

  it('un bureau d’avant l’ouverture de l’app n’est pas un lancement, ni un bureau sans date', async () => {
    liste = [lance('hier', '08:00:00'), { id: 'sans-date', travail: 'x', conversationId: 'conv-1' }]
    await rendre()
    await attendre(5000)
    expect(rappel).not.toHaveBeenCalled()
  })

  it('jumeau : deux fils ne partagent pas leur mémoire', async () => {
    liste = [lance('a')]
    await rendre()
    await rendre({ fils: ['conv-2'] })
    expect(rappel).toHaveBeenCalledTimes(2)
    expect(rappel.mock.lastCall?.[1]).toBe('conv-2')
  })

  it('super conv : un lot qui lance son bureau est vu depuis n’importe quel fil du chantier', async () => {
    api.hdeskTvBureaux.mockImplementation(async (fil?: string) => (fil === 'lot-2' ? liste : []))
    await rendre({ fils: ['chef', 'lot-1', 'lot-2'] })
    expect(rappel).not.toHaveBeenCalled()
    liste = [lance('b')]
    await attendre(5000)
    expect(rappel).toHaveBeenCalledTimes(1)
    expect(rappel.mock.lastCall?.[1]).toBe('lot-2')
  })

  it('un tableau neuf aux mêmes fils ne relance pas la lecture', async () => {
    await rendre({ fils: ['conv-1'] })
    await rendre({ fils: ['conv-1'] })
    expect(api.hdeskTvBureaux).toHaveBeenCalledTimes(1)
  })

  it('inactif ou sans fil : rien n’est lu ; au retour, la lecture repart aussitôt', async () => {
    liste = [lance('a')]
    await rendre({ actif: false })
    await rendre({ actif: true, fils: [] })
    await attendre(20000)
    expect(api.hdeskTvBureaux).not.toHaveBeenCalled()
    await rendre({ actif: true })
    expect(api.hdeskTvBureaux).toHaveBeenCalledTimes(1)
    expect(rappel).toHaveBeenCalledTimes(1)
  })

  it('la liste n’est redemandée qu’au rythme du guet (5 s)', async () => {
    await rendre()
    expect(api.hdeskTvBureaux).toHaveBeenCalledTimes(1)
    await attendre(4999)
    expect(api.hdeskTvBureaux).toHaveBeenCalledTimes(1)
    await attendre(1)
    expect(api.hdeskTvBureaux).toHaveBeenCalledTimes(2)
  })

  it('liste en échec : l’attente double (5, 10, 20 s), plafonnée à 60 s, puis repart à 5 s', async () => {
    api.hdeskTvBureaux.mockRejectedValue(new Error('capture morte'))
    await rendre()
    const appels = (): number => api.hdeskTvBureaux.mock.calls.length
    expect(appels()).toBe(1)
    for (const [attente, total] of [
      [5000, 2],
      [10000, 3],
      [20000, 4],
      [40000, 5],
      [60000, 6],
      [60000, 7]
    ]) {
      await attendre(attente - 1)
      expect(appels()).toBe(total - 1)
      await attendre(1)
      expect(appels()).toBe(total)
    }
    api.hdeskTvBureaux.mockResolvedValue([])
    await attendre(60000)
    expect(appels()).toBe(8)
    await attendre(5000)
    expect(appels()).toBe(9)
    expect(rappel).not.toHaveBeenCalled()
  })

  it('une lecture rendue après le changement de fil n’annonce plus rien', async () => {
    let rendreListe: (l: BureauTv[]) => void = () => undefined
    api.hdeskTvBureaux.mockReturnValueOnce(new Promise((r) => (rendreListe = r)))
    await rendre()
    await rendre({ fils: ['conv-2'] })
    await act(async () => rendreListe([lance('a')]))
    expect(rappel).not.toHaveBeenCalled()
  })
})

describe('filsDuPanneau', () => {
  const liens = new Map([
    ['lot-1', { chef: 'chef', onglet: true }],
    ['lot-2', { chef: 'chef', onglet: true }],
    ['ancien', { chef: 'chef', onglet: false }],
    ['ailleurs', { chef: 'autre', onglet: true }]
  ])

  it('sans fil : aucun ; hors super conv : le fil seul', () => {
    expect(filsDuPanneau(null, null, liens)).toEqual([])
    expect(filsDuPanneau('seul', null, liens)).toEqual(['seul'])
  })

  it('depuis le chef ou depuis un lot : le chef et les lots à onglet, sans doublon', () => {
    expect(filsDuPanneau('chef', 'chef', liens)).toEqual(['chef', 'lot-1', 'lot-2'])
    expect(filsDuPanneau('lot-2', 'chef', liens)).toEqual(['chef', 'lot-2', 'lot-1'])
  })
})
