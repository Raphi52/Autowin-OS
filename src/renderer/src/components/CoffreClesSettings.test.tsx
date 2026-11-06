// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoffreClesSettings } from './CoffreClesSettings'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const monte: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
afterEach(async () => {
  for (const m of monte.splice(0)) {
    await act(async () => m.root.unmount())
    m.el.remove()
  }
})

const posteCle = {
  nom: 'OPENAI_API_KEY',
  origine: 'poste' as const,
  ajouteLe: '2026-11-06T08:00:00.000Z',
  longueur: 51
}
const maCle = {
  nom: 'GITHUB_TOKEN',
  origine: 'utilisateur' as const,
  ajouteLe: '2026-11-05T10:00:00.000Z',
  longueur: 1
}
const etat = (cles = [posteCle, maCle]) => ({ disponible: true, cles })

async function monter(api: Record<string, unknown>): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = api
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  monte.push({ root, el })
  await act(async () => root.render(createElement(CoffreClesSettings)))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return el
}

const q = (el: HTMLElement, id: string): HTMLElement =>
  el.querySelector(`[data-testid="${id}"]`) as HTMLElement

async function saisir(champ: HTMLElement, valeur: string): Promise<void> {
  const proto = Object.getPrototypeOf(champ)
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(champ, valeur)
  await act(async () => champ.dispatchEvent(new Event('input', { bubbles: true })))
}

async function cliquer(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.click()
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('CoffreClesSettings', () => {
  it('liste nom, origine, date et longueur — et la phrase sur l’usage par nom', async () => {
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat()) })
    expect(q(el, 'coffre-phrase').textContent).toBe(
      'Les agents se servent de ces clés par leur nom, sans voir ni afficher leur valeur.'
    )
    expect(q(el, 'coffre-cle-OPENAI_API_KEY').textContent).toContain('OPENAI_API_KEY')
    expect(q(el, 'coffre-origine-OPENAI_API_KEY').textContent).toBe('importée du poste')
    expect(q(el, 'coffre-origine-GITHUB_TOKEN').textContent).toBe('ajoutée par toi')
    expect(q(el, 'coffre-detail-OPENAI_API_KEY').textContent).toContain('51 caractères')
    expect(q(el, 'coffre-detail-OPENAI_API_KEY').textContent).toContain('2026')
    // Singulier : « 1 caractère », pas « 1 caractères ».
    expect(q(el, 'coffre-detail-GITHUB_TOKEN').textContent).toMatch(/1 caractère$/)
  })

  it('ajoute par nom + valeur masquée, puis vide les deux champs', async () => {
    const coffreAjouter = vi.fn().mockResolvedValue({
      ok: true,
      etat: etat([posteCle, maCle, { ...maCle, nom: 'MON_TOKEN', longueur: 12 }])
    })
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat()), coffreAjouter })
    const champValeur = q(el, 'coffre-champ-valeur') as HTMLInputElement
    expect(champValeur.type).toBe('password')
    await saisir(q(el, 'coffre-champ-nom'), ' MON_TOKEN ')
    await saisir(champValeur, 'valeur-tres-secrete')
    await cliquer(q(el, 'coffre-ajouter'))
    expect(coffreAjouter).toHaveBeenCalledWith('MON_TOKEN', 'valeur-tres-secrete')
    expect((q(el, 'coffre-champ-nom') as HTMLInputElement).value).toBe('')
    expect(champValeur.value).toBe('')
    expect(q(el, 'coffre-cle-MON_TOKEN')).not.toBeNull()
    // La valeur saisie n'est nulle part dans la page une fois enregistrée.
    expect(el.innerHTML).not.toContain('valeur-tres-secrete')
  })

  it('un ajout refusé montre la raison et garde la saisie pour la corriger', async () => {
    const coffreAjouter = vi
      .fn()
      .mockResolvedValue({ ok: false, erreur: 'Nom de clé invalide.', etat: etat() })
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat()), coffreAjouter })
    await saisir(q(el, 'coffre-champ-nom'), 'mauvais nom')
    await saisir(q(el, 'coffre-champ-valeur'), 'abc')
    await cliquer(q(el, 'coffre-ajouter'))
    expect(q(el, 'coffre-erreur').textContent).toBe('Nom de clé invalide.')
    expect((q(el, 'coffre-champ-nom') as HTMLInputElement).value).toBe('mauvais nom')
    expect((q(el, 'coffre-champ-valeur') as HTMLInputElement).value).toBe('abc')
  })

  it('retire une clé par son nom', async () => {
    const coffreRetirer = vi.fn().mockResolvedValue({ ok: true, etat: etat([posteCle]) })
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat()), coffreRetirer })
    await cliquer(q(el, 'coffre-retirer-GITHUB_TOKEN'))
    expect(coffreRetirer).toHaveBeenCalledWith('GITHUB_TOKEN')
    expect(q(el, 'coffre-cle-GITHUB_TOKEN')).toBeNull()
    expect(q(el, 'coffre-cle-OPENAI_API_KEY')).not.toBeNull()
  })

  it('réimporte depuis le poste et donne le compte rendu', async () => {
    const coffreReimporter = vi.fn().mockResolvedValue({
      ok: true,
      bilan: { ajoutees: 3, misesAJour: 0, ignorees: 2 },
      etat: etat()
    })
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat()), coffreReimporter })
    await cliquer(q(el, 'coffre-reimporter'))
    expect(coffreReimporter).toHaveBeenCalledTimes(1)
    expect(q(el, 'coffre-bilan').textContent).toBe('Réimport terminé : 3 ajoutées.')
  })

  it('chiffrement indisponible : message clair, ajout et réimport coupés', async () => {
    const el = await monter({
      coffreLister: vi.fn().mockResolvedValue({
        disponible: false,
        raison: 'safeStorage indisponible.',
        cles: []
      })
    })
    expect(q(el, 'coffre-indisponible').textContent).toContain(
      'Le chiffrement de Windows n’est pas disponible'
    )
    expect(q(el, 'coffre-indisponible').textContent).toContain('safeStorage indisponible.')
    expect((q(el, 'coffre-reimporter') as HTMLButtonElement).disabled).toBe(true)
    expect((q(el, 'coffre-ajouter') as HTMLButtonElement).disabled).toBe(true)
    expect((q(el, 'coffre-champ-valeur') as HTMLInputElement).disabled).toBe(true)
    expect(q(el, 'coffre-vide')).toBeNull()
  })

  it('coffre disponible : rien d’indisponible, le réimport reste ouvert', async () => {
    const el = await monter({ coffreLister: vi.fn().mockResolvedValue(etat([])) })
    expect(q(el, 'coffre-indisponible')).toBeNull()
    expect(q(el, 'coffre-vide').textContent).toBe('Aucune clé dans le coffre.')
    expect((q(el, 'coffre-reimporter') as HTMLButtonElement).disabled).toBe(false)
  })

  it('un coffre injoignable se dit, sans planter la section', async () => {
    const el = await monter({})
    expect(q(el, 'coffre-erreur').textContent).toBe('Impossible de joindre le coffre à clés.')
    expect(q(el, 'coffre-phrase')).not.toBeNull()
  })
})
