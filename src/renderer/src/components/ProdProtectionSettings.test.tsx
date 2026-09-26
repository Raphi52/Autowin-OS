// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProdProtectionSettings } from './ProdProtectionSettings'
import type { EtatPorteProd } from '../../../shared/prod-protection'

/**
 * L'ÉCRAN DE RÉGLAGE DE LA PROTECTION — ce qui est vérifié ici :
 *   - l'état est DIT en clair, et une protection qui dort ne s'affiche jamais comme active ;
 *   - changer la phrase exige la phrase en cours ;
 *   - les champs masqués sont vidés à chaque sortie, réussie ou non.
 */
let hote: HTMLDivElement
let racine: Root

const PORTE_CONFIRMATION: EtatPorteProd = {
  active: true,
  niveau: 'confirmation' as const,
  raison: 'Chaque geste de production ouvre une fenêtre de confirmation.',
  phraseDefinie: false,
  declarees: 0,
  anomalies: [] as string[],
  chemin: 'C:/data/prod-autorite.json'
}

const PORTE_DORT: EtatPorteProd = {
  ...PORTE_CONFIRMATION,
  active: false,
  niveau: 'aucun' as const,
  raison: 'Protection désactivée : les gestes de production partent sans rien demander.'
}

const PORTE_ACTIVE: EtatPorteProd = {
  ...PORTE_CONFIRMATION,
  niveau: 'phrase' as const,
  raison: 'Chaque geste de production demande la phrase de passe.',
  phraseDefinie: true,
  declarees: 3,
  anomalies: ['classe « ouvert » invalide']
}

function poserApi(
  options: {
    definie?: boolean
    porte?: EtatPorteProd
    definir?: () => Promise<{ ok: boolean; erreur?: string }>
  } = {}
) {
  const api = {
    prodPorteEtat: vi.fn(async () => options.porte ?? PORTE_CONFIRMATION),
    prodPorteNiveau: vi.fn(async () => ({ ok: true }) as { ok: boolean; erreur?: string }),
    prodPassphraseEtat: vi.fn(async () => ({
      definie: options.definie ?? false,
      definieLe: 1,
      longueurMinimale: 12
    })),
    prodPassphraseDefinir: vi.fn(
      options.definir ?? (async (): Promise<{ ok: boolean; erreur?: string }> => ({ ok: true }))
    )
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ProdProtectionSettings />)
  })
  // La lecture initiale passe par `queueMicrotask` : on laisse la file se vider.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function champ(id: string): HTMLInputElement {
  return hote.querySelector(`#${id}`) as HTMLInputElement
}

async function taper(id: string, valeur: string): Promise<void> {
  const entree = champ(id)
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(entree, valeur)
    entree.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function valider(): Promise<void> {
  await act(async () => {
    ;(hote.querySelector('.prod-valider') as HTMLButtonElement).click()
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

describe('état affiché', () => {
  it('dit « Active » par défaut : toute requête prod ouvre une confirmation', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Active')
    expect(hote.textContent).toContain('fenêtre de confirmation')
  })

  it('dit « Inactive » SEULEMENT quand le niveau est « aucun »', async () => {
    poserApi({ porte: PORTE_DORT })
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Inactive')
    expect(hote.textContent).toContain('sans rien demander')
  })

  it('dit « Active » au niveau phrase', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Active')
  })

  it('AVERTIT que zéro cible déclarée rendra tout bloquant', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-declarees"]')?.textContent).toContain(
      'maquettes comprises'
    )
  })

  it('montre le fichier de déclaration et les lignes écartées', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(hote.textContent).toContain('prod-autorite.json')
    expect(hote.querySelector('[data-testid="prod-protection-anomalies"]')?.textContent).toContain(
      'classe « ouvert » invalide'
    )
  })

  it('affiche « Inconnu » — jamais « Active » — quand l’état est illisible', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      prodPorteEtat: vi.fn(async () => {
        throw new Error('canal coupé')
      }),
      prodPassphraseEtat: vi.fn(async () => {
        throw new Error('canal coupé')
      }),
      prodPassphraseDefinir: vi.fn()
    }
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Inconnu')
  })
})

describe('définition et changement', () => {
  it('ne demande PAS de phrase actuelle au premier réglage', async () => {
    const api = poserApi()
    await rendre()
    expect(champ('prod-actuelle')).toBeNull()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(api.prodPassphraseDefinir).toHaveBeenCalledWith('ma-toute-premiere-phrase', undefined)
    expect(hote.textContent).toContain('Protection activée')
  })

  it('exige la phrase actuelle pour en changer, et la transmet', async () => {
    const api = poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(champ('prod-actuelle')).not.toBeNull()
    await taper('prod-actuelle', 'phrase-de-passe-de-reference')
    await taper('prod-nouvelle', 'une-autre-phrase-longue')
    await taper('prod-confirmation', 'une-autre-phrase-longue')
    await valider()
    expect(api.prodPassphraseDefinir).toHaveBeenCalledWith(
      'une-autre-phrase-longue',
      'phrase-de-passe-de-reference'
    )
  })

  it('n’envoie RIEN quand les deux saisies diffèrent', async () => {
    const api = poserApi()
    await rendre()
    await taper('prod-nouvelle', 'une-phrase-bien-longue')
    await taper('prod-confirmation', 'une-phrase-differente')
    await valider()
    expect(api.prodPassphraseDefinir).not.toHaveBeenCalled()
    expect(hote.textContent).toContain('ne correspondent pas')
  })

  it('affiche le refus du processus principal et VIDE les champs', async () => {
    poserApi({
      definie: true,
      porte: PORTE_ACTIVE,
      definir: async () => ({ ok: false, erreur: 'Phrase de passe actuelle incorrecte.' })
    })
    await rendre()
    await taper('prod-actuelle', 'pas-la-bonne-du-tout')
    await taper('prod-nouvelle', 'une-autre-phrase-longue')
    await taper('prod-confirmation', 'une-autre-phrase-longue')
    await valider()
    expect(hote.textContent).toContain('actuelle incorrecte')
    expect(champ('prod-actuelle').value).toBe('')
    expect(champ('prod-nouvelle').value).toBe('')
    expect(champ('prod-confirmation').value).toBe('')
  })

  it('vide aussi les champs après une réussite', async () => {
    poserApi()
    await rendre()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(champ('prod-nouvelle').value).toBe('')
    expect(champ('prod-confirmation').value).toBe('')
  })

  it('n’affiche jamais la phrase : les champs sont masqués', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    for (const id of ['prod-actuelle', 'prod-nouvelle', 'prod-confirmation']) {
      expect(champ(id).type).toBe('password')
    }
  })

  it('garde le bouton inactif tant que les champs neufs sont vides', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector<HTMLButtonElement>('.prod-valider')?.disabled).toBe(true)
  })

  it('relit l’état après un changement réussi : l’écran ne ment pas sur ce qui vient d’arriver', async () => {
    const api = poserApi()
    await rendre()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(api.prodPorteEtat.mock.calls.length).toBeGreaterThan(1)
  })
})

/**
 * LE CHOIX DU NIVEAU — la vraie décision de cet écran. Le défaut, `confirmation`, répond au besoin
 * énoncé : une fenêtre « voulez-vous continuer ? » avant toute requête sur une base de production.
 */
describe('choix du niveau', () => {
  it('coche le niveau en vigueur, sans rien changer', async () => {
    const api = poserApi()
    await rendre()
    expect(hote.querySelector<HTMLInputElement>('#prod-niveau-confirmation')?.checked).toBe(true)
    expect(api.prodPorteNiveau).not.toHaveBeenCalled()
  })

  it('change le niveau au clic, et relit l’état ensuite', async () => {
    const api = poserApi()
    await rendre()
    await act(async () => {
      ;(hote.querySelector('#prod-niveau-phrase') as HTMLInputElement).click()
    })
    expect(api.prodPorteNiveau).toHaveBeenCalledWith('phrase')
    expect(api.prodPorteEtat.mock.calls.length).toBeGreaterThan(1)
  })

  it('affiche le refus du processus principal quand il garde la main', async () => {
    const api = poserApi({ definie: true, porte: PORTE_ACTIVE })
    api.prodPorteNiveau.mockResolvedValueOnce({
      ok: false,
      erreur: 'Saisis la phrase de passe pour baisser la garde.'
    })
    await rendre()
    await act(async () => {
      ;(hote.querySelector('#prod-niveau-aucun') as HTMLInputElement).click()
    })
    expect(hote.textContent).toContain('baisser la garde')
  })

  it('ne montre le formulaire de phrase QU’AU niveau phrase', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector<HTMLElement>('.prod-formulaire')?.hidden).toBe(true)
  })
})
