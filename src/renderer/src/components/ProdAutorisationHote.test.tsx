// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProdAutorisationHote } from './ProdAutorisationHote'

/**
 * LE CHAÎNON ÉCRAN, VU DEPUIS L'INTERFACE : une demande publiée par le processus principal OUVRE
 * l'écran de saisie, et le jeton obtenu REPART par le canal de dépôt. C'est exactement ce qui
 * manquait : la porte refusait, l'écran existait, personne ne l'ouvrait.
 */
let hote: HTMLDivElement
let racine: Root

const DEMANDE = {
  id: 'd1',
  cible: 'base:RIG_AMIENS',
  operation: 'sql-read',
  raison: 'Production déclarée : base de production',
  niveau: 'phrase' as const
}

/** Le cas par DÉFAUT : une simple confirmation, sans phrase de passe. */
const DEMANDE_CONFIRMATION = { ...DEMANDE, niveau: 'confirmation' as const }

type DemandePubliee = typeof DEMANDE | typeof DEMANDE_CONFIRMATION

function poserApi(surcharges: Record<string, unknown> = {}) {
  let publier: ((d: DemandePubliee) => void) | undefined
  let fermer: ((id: string) => void) | undefined
  const api = {
    prodAutorisationEnAttente: vi.fn(async () => []),
    prodAutorisationDeposer: vi.fn(async () => ({ ok: true })),
    prodAutorisationAnnuler: vi.fn(async () => ({ ok: true })),
    prodAutorisationConfirmer: vi.fn(async () => ({ ok: true })),
    onProdAutorisationDemandee: vi.fn((cb: (d: DemandePubliee) => void) => {
      publier = cb
      return () => {
        publier = undefined
      }
    }),
    onProdAutorisationClose: vi.fn((cb: (id: string) => void) => {
      fermer = cb
      return () => {
        fermer = undefined
      }
    }),
    prodPassphraseEtat: vi.fn(async () => ({ definie: true, definieLe: 1, longueurMinimale: 12 })),
    prodPassphraseAutoriser: vi.fn(async () => ({
      accorde: true,
      jeton: 'jeton-opaque',
      expireLe: 9_999
    })),
    prodPassphraseDefinir: vi.fn(async () => ({ ok: true })),
    ...surcharges
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return {
    api,
    publier: (d: DemandePubliee = DEMANDE) => publier?.(d),
    fermer: (id: string) => fermer?.(id)
  }
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ProdAutorisationHote />)
  })
}

beforeEach(() => {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})

afterEach(async () => {
  await act(async () => racine.unmount())
  hote.remove()
  vi.restoreAllMocks()
})

describe('ProdAutorisationHote', () => {
  it('n’affiche RIEN tant qu’aucun geste n’est bloqué', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector('.ppg')).toBeNull()
  })

  it('ouvre l’écran à la demande, avec la cible et l’opération bloquées', async () => {
    const { publier } = poserApi()
    await rendre()
    await act(async () => {
      publier()
    })
    expect(hote.querySelector('.ppg')).not.toBeNull()
    expect(hote.textContent).toContain('base:RIG_AMIENS')
    expect(hote.textContent).toContain('sql-read')
    expect(hote.textContent).toContain('base de production')
  })

  it('dépose le jeton obtenu avec l’identifiant de la demande, puis referme', async () => {
    const { api, publier } = poserApi()
    await rendre()
    await act(async () => {
      publier()
    })
    const champ = hote.querySelector('#ppg-champ') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(champ, 'phrase-de-passe-longue')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const valider = hote.querySelector('.ppg-valider') as HTMLButtonElement
    await act(async () => {
      valider.click()
    })
    expect(api.prodAutorisationDeposer).toHaveBeenCalledWith('d1', 'jeton-opaque')
    expect(hote.querySelector('.ppg')).toBeNull()
  })

  it('annule la demande quand l’utilisateur refuse — le geste reste bloqué', async () => {
    const { api, publier } = poserApi()
    await rendre()
    await act(async () => {
      publier()
    })
    await act(async () => {
      ;(hote.querySelector('.ppg-annuler') as HTMLButtonElement).click()
    })
    expect(api.prodAutorisationAnnuler).toHaveBeenCalledWith('d1')
    expect(api.prodAutorisationDeposer).not.toHaveBeenCalled()
    expect(hote.querySelector('.ppg')).toBeNull()
  })

  it('retire l’écran quand le processus principal referme la demande (délai expiré)', async () => {
    const { publier, fermer } = poserApi()
    await rendre()
    await act(async () => {
      publier()
    })
    await act(async () => {
      fermer('d1')
    })
    expect(hote.querySelector('.ppg')).toBeNull()
  })

  it('rouvre les demandes déjà en attente quand la fenêtre se recharge', async () => {
    poserApi({ prodAutorisationEnAttente: vi.fn(async () => [DEMANDE]) })
    await rendre()
    expect(hote.querySelector('.ppg')).not.toBeNull()
  })

  it('n’affiche QU’UNE demande à la fois : la seconde attend son tour', async () => {
    const { api, publier } = poserApi()
    await rendre()
    await act(async () => {
      publier()
      publier({ ...DEMANDE, id: 'd2', cible: 'base:RIG_LYON' })
    })
    expect(hote.querySelectorAll('.ppg')).toHaveLength(1)
    expect(hote.textContent).toContain('base:RIG_AMIENS')
    await act(async () => {
      ;(hote.querySelector('.ppg-annuler') as HTMLButtonElement).click()
    })
    expect(api.prodAutorisationAnnuler).toHaveBeenCalledWith('d1')
    expect(hote.textContent).toContain('base:RIG_LYON')
  })

  it('ne casse rien si le shell n’expose pas ces canaux', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {}
    await rendre()
    expect(hote.querySelector('.ppg')).toBeNull()
  })
})

/**
 * LE NIVEAU « CONFIRMATION » : la fenêtre pose la question et rien d'autre. Afficher un champ de mot
 * de passe là où un clic suffit ferait croire à une protection plus forte qu'elle n'est.
 */
describe('fenêtre de confirmation', () => {
  it('demande « voulez-vous continuer ? » SANS champ de phrase', async () => {
    const { publier } = poserApi()
    await rendre()
    await act(async () => {
      publier(DEMANDE_CONFIRMATION)
    })
    expect(hote.textContent).toContain('Voulez-vous continuer')
    expect(hote.textContent).toContain('base:RIG_AMIENS')
    expect(hote.querySelector('#ppg-champ')).toBeNull()
  })

  it('renvoie la confirmation au processus principal, sans jeton', async () => {
    const { api, publier } = poserApi()
    await rendre()
    await act(async () => {
      publier(DEMANDE_CONFIRMATION)
    })
    await act(async () => {
      ;(hote.querySelector('[data-testid="ppg-continuer"]') as HTMLButtonElement).click()
    })
    expect(api.prodAutorisationConfirmer).toHaveBeenCalledWith('d1')
    expect(api.prodAutorisationDeposer).not.toHaveBeenCalled()
    expect(hote.querySelector('.ppg')).toBeNull()
  })

  it('annule sans rien confirmer quand l’utilisateur refuse', async () => {
    const { api, publier } = poserApi()
    await rendre()
    await act(async () => {
      publier(DEMANDE_CONFIRMATION)
    })
    await act(async () => {
      ;(hote.querySelector('.ppg-annuler') as HTMLButtonElement).click()
    })
    expect(api.prodAutorisationAnnuler).toHaveBeenCalledWith('d1')
    expect(api.prodAutorisationConfirmer).not.toHaveBeenCalled()
  })
})
