// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProdPassphraseGate } from './ProdPassphraseGate'

/**
 * L'ÉCRAN DE LA PHRASE DE PASSE — ce qui est vérifié ici :
 *   - la cible et l'opération sont LISIBLES avant la saisie (autoriser à l'aveugle n'est pas
 *     autoriser) ;
 *   - la phrase part vers le processus principal et n'est jamais rendue ni conservée ;
 *   - un refus vide le champ et n'accorde rien.
 */
let hote: HTMLDivElement
let racine: Root

const DEMANDE = {
  cible: 'base:RIG_AMIENS',
  operation: 'sql-write',
  raison: 'Production déclarée : greffe exploité'
}

interface ApiSimulee {
  prodPassphraseEtat: ReturnType<typeof vi.fn>
  prodPassphraseDefinir: ReturnType<typeof vi.fn>
  prodPassphraseAutoriser: ReturnType<typeof vi.fn>
}

function poserApi(api: Partial<ApiSimulee>): ApiSimulee {
  const complet: ApiSimulee = {
    prodPassphraseEtat: vi.fn(async () => ({ definie: true, definieLe: 1, longueurMinimale: 12 })),
    prodPassphraseDefinir: vi.fn(async () => ({ ok: true })),
    prodPassphraseAutoriser: vi.fn(async () => ({
      accorde: true,
      jeton: 'jeton-opaque',
      expireLe: 9_999
    })),
    ...api
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = complet
  return complet
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

async function monter(
  api: Partial<ApiSimulee>,
  rappels: { onAutorise?: (jeton: string) => void; onAnnule?: () => void } = {}
) {
  const simulee = poserApi(api)
  await act(async () => {
    racine.render(
      <ProdPassphraseGate
        demande={DEMANDE}
        onAutorise={rappels.onAutorise ?? (() => undefined)}
        onAnnule={rappels.onAnnule ?? (() => undefined)}
      />
    )
  })
  return simulee
}

function champ(): HTMLInputElement {
  const trouve = hote.querySelector<HTMLInputElement>('#ppg-champ')
  if (!trouve) throw new Error('champ de saisie absent')
  return trouve
}

async function taper(valeur: string) {
  const entree = champ()
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(entree, valeur)
    entree.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function cliquer(selecteur: string) {
  const bouton = hote.querySelector<HTMLButtonElement>(selecteur)
  if (!bouton) throw new Error(`bouton absent : ${selecteur}`)
  await act(async () => {
    bouton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('ce que l’écran montre', () => {
  it('affiche la cible, l’opération et la raison du blocage AVANT toute saisie', async () => {
    await monter({})
    expect(hote.textContent).toContain('base:RIG_AMIENS')
    expect(hote.textContent).toContain('sql-write')
    expect(hote.textContent).toContain('greffe exploité')
  })

  it('dit que l’autorisation est bornée', async () => {
    await monter({})
    expect(hote.textContent).toContain('une seule fois')
  })

  it('masque la saisie — le champ est de type mot de passe', async () => {
    await monter({})
    expect(champ().type).toBe('password')
    expect(champ().autocomplete).toBe('off')
  })

  it('propose de DÉFINIR la phrase quand aucune n’existe', async () => {
    await monter({
      prodPassphraseEtat: vi.fn(async () => ({
        definie: false,
        definieLe: 0,
        longueurMinimale: 12
      }))
    })
    expect(hote.textContent).toContain('Définis la phrase de passe')
    expect(hote.querySelector('.ppg-valider')?.textContent).toBe('Enregistrer')
  })
})

describe('autorisation', () => {
  it('envoie la phrase avec la cible ET l’opération, puis rend le jeton', async () => {
    const jetons: string[] = []
    const api = await monter({}, { onAutorise: (jeton) => jetons.push(jeton) })
    await taper('phrase-de-passe-de-reference')
    await cliquer('.ppg-valider')
    expect(api.prodPassphraseAutoriser).toHaveBeenCalledWith('phrase-de-passe-de-reference', {
      cible: DEMANDE.cible,
      operation: DEMANDE.operation
    })
    expect(jetons).toEqual(['jeton-opaque'])
  })

  /** Un champ de mot de passe qui garde sa valeur après un refus est une fuite en attente. */
  it('vide le champ après un refus, et n’accorde rien', async () => {
    const jetons: string[] = []
    await monter(
      {
        prodPassphraseAutoriser: vi.fn(async () => ({
          accorde: false,
          motif: 'Phrase de passe incorrecte.'
        }))
      },
      { onAutorise: (jeton) => jetons.push(jeton) }
    )
    await taper('mauvaise-phrase-longue')
    await cliquer('.ppg-valider')
    expect(hote.textContent).toContain('Phrase de passe incorrecte.')
    expect(champ().value).toBe('')
    expect(jetons).toEqual([])
  })

  it('vide aussi le champ après une réussite', async () => {
    await monter({})
    await taper('phrase-de-passe-de-reference')
    await cliquer('.ppg-valider')
    expect(champ().value).toBe('')
  })

  it('n’envoie rien quand le champ est vide — le bouton reste inactif', async () => {
    const api = await monter({})
    expect(hote.querySelector<HTMLButtonElement>('.ppg-valider')?.disabled).toBe(true)
    await cliquer('.ppg-valider')
    expect(api.prodPassphraseAutoriser).not.toHaveBeenCalled()
  })

  it('affiche un message plutôt que de rester muet si le canal échoue', async () => {
    await monter({
      prodPassphraseAutoriser: vi.fn(async () => {
        throw new Error('canal coupé')
      })
    })
    await taper('phrase-de-passe-de-reference')
    await cliquer('.ppg-valider')
    expect(hote.querySelector('.ppg-message')?.textContent).toContain('pas pu être demandée')
    expect(champ().value).toBe('')
  })
})

describe('définition puis autorisation', () => {
  it('enregistre la phrase, puis demande de la saisir — sans autoriser au passage', async () => {
    const jetons: string[] = []
    const api = await monter(
      {
        prodPassphraseEtat: vi.fn(async () => ({
          definie: false,
          definieLe: 0,
          longueurMinimale: 12
        }))
      },
      { onAutorise: (jeton) => jetons.push(jeton) }
    )
    await taper('ma-nouvelle-phrase')
    await cliquer('.ppg-valider')
    expect(api.prodPassphraseDefinir).toHaveBeenCalledWith('ma-nouvelle-phrase')
    expect(api.prodPassphraseAutoriser).not.toHaveBeenCalled()
    expect(jetons).toEqual([])
    expect(champ().value).toBe('')
    expect(hote.querySelector('.ppg-valider')?.textContent).toBe('Autoriser')
  })

  it('montre l’erreur quand la phrase proposée est refusée', async () => {
    await monter({
      prodPassphraseEtat: vi.fn(async () => ({
        definie: false,
        definieLe: 0,
        longueurMinimale: 12
      })),
      prodPassphraseDefinir: vi.fn(async () => ({ ok: false, erreur: 'Trop courte.' }))
    })
    await taper('court')
    await cliquer('.ppg-valider')
    expect(hote.textContent).toContain('Trop courte.')
    expect(hote.querySelector('.ppg-valider')?.textContent).toBe('Enregistrer')
  })
})

describe('annulation', () => {
  it('vide la phrase et prévient l’appelant', async () => {
    let annule = false
    await monter({}, { onAnnule: () => (annule = true) })
    await taper('phrase-de-passe-de-reference')
    await cliquer('.ppg-annuler')
    expect(annule).toBe(true)
  })

  /** Sans repli, un état illisible afficherait un écran vide qui aurait l'air « ouvert ». */
  it('retombe sur le mode le plus fermé si l’état est illisible', async () => {
    await monter({
      prodPassphraseEtat: vi.fn(async () => {
        throw new Error('canal coupé')
      })
    })
    expect(hote.querySelector('.ppg-valider')?.textContent).toBe('Autoriser')
  })
})
