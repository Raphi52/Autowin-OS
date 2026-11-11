// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DossiersDeTravailPanel } from './DossiersDeTravailPanel'

const ROTATION = 'D:\\BrainRotRoyale'

type Demande = ReturnType<typeof vi.fn>
interface ApiAffectations {
  brainAffectations: Demande
  enregistrerBrainAffectation: Demande
  retirerBrainAffectation: Demande
}

/** Le pont du lot 3, simulé : chaque demande rend la liste telle que le processus principal la renverrait. */
function installerApi(liste: unknown[] = []): ApiAffectations {
  const api: ApiAffectations = {
    brainAffectations: vi.fn().mockResolvedValue({ affectations: liste }),
    enregistrerBrainAffectation: vi.fn().mockResolvedValue({ affectations: liste }),
    retirerBrainAffectation: vi.fn().mockResolvedValue({ affectations: [] })
  }
  ;(window as unknown as { api: ApiAffectations }).api = api
  return api
}

const flush = (): Promise<void> =>
  act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('DossiersDeTravailPanel — rendu de base et demandes', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete (window as unknown as { api?: unknown }).api
  })

  const monter = async (): Promise<void> => {
    await act(async () => {
      root.render(createElement(DossiersDeTravailPanel))
    })
    await flush()
  }
  const champ = (): HTMLInputElement =>
    container.querySelector<HTMLInputElement>('input[type="text"]') as HTMLInputElement
  const selectDe = (cwd: string): HTMLSelectElement | undefined =>
    [...container.querySelectorAll<HTMLSelectElement>('select')].find(
      (liste) => liste.getAttribute('aria-label') === `Brain de ${cwd}`
    )
  const selectAjout = (): HTMLSelectElement | undefined =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Brain du nouveau dossier"]') ??
    undefined
  const bouton = (libelle: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === libelle
    )
  const cliquer = async (cible: HTMLButtonElement | undefined): Promise<void> => {
    if (!cible) throw new Error('bouton absent')
    await act(async () => cible.click())
    await flush()
  }
  const saisir = async (zone: HTMLInputElement, valeur: string): Promise<void> => {
    const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      poser?.call(zone, valeur)
      zone.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const choisir = async (liste: HTMLSelectElement | undefined, valeur: string): Promise<void> => {
    if (!liste) throw new Error('liste absente')
    await act(async () => {
      liste.value = valeur
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }
  /** Un échec : la demande n'a rien modifié. */
  const alerte = (): string | undefined =>
    container.querySelector('[role="alert"]')?.textContent ?? undefined
  /**
   * Un avertissement : la demande a abouti, et le message l'accompagne. Il porte la classe
   * d'avertissement du thème (`domain-warning`, celle des réglages du Brain), pas le style d'aide.
   */
  const avertissement = (): string | undefined =>
    container.querySelector('.domain-warning[role="status"]:not(.setting-help)')?.textContent ??
    undefined

  it('rend chaque dossier assigné avec son Brain et son bouton de retrait', async () => {
    installerApi([{ cwd: ROTATION, brain: 'perso' }])
    await monter()
    expect(container.textContent).toContain(ROTATION)
    expect(selectDe(ROTATION)?.value).toBe('perso')
    expect(bouton('Retirer')).toBeDefined()
  })

  it('dit qu’aucun dossier n’est assigné quand la liste est vide', async () => {
    installerApi([])
    await monter()
    expect(container.textContent).toContain('Aucun dossier assigné')
    expect(container.querySelector('ul')).toBeNull()
  })

  it('assigne un chemin absolu avec le Brain choisi, puis affiche la liste renvoyée', async () => {
    const api = installerApi([])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'perso' }]
    })
    await monter()
    await saisir(champ(), ROTATION)
    await choisir(selectAjout(), 'perso')
    await cliquer(bouton('Assigner'))
    expect(api.enregistrerBrainAffectation).toHaveBeenCalledWith({
      cwd: ROTATION,
      brain: 'perso'
    })
    expect(selectDe(ROTATION)?.value).toBe('perso')
    expect(champ().value).toBe('')
  })

  it('montre la raison d’un refus et garde le chemin saisi', async () => {
    const api = installerApi([])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [],
      erreur: 'Chemin absolu obligatoire.'
    })
    await monter()
    await saisir(champ(), 'relatif')
    await cliquer(bouton('Assigner'))
    expect(alerte()).toBe('Chemin absolu obligatoire.')
    expect(avertissement()).toBeUndefined()
    expect(champ().value).toBe('relatif')
  })

  it('lit un ajout réussi dans la liste même si la réponse porte une `erreur` : la saisie se vide, et le message s’affiche en avertissement, pas en alerte', async () => {
    const api = installerApi([])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'perso' }],
      erreur: 'Fichier illisible mis de côté.'
    })
    await monter()
    await saisir(champ(), ROTATION)
    await choisir(selectAjout(), 'perso')
    await cliquer(bouton('Assigner'))
    expect(selectDe(ROTATION)?.value).toBe('perso')
    expect(champ().value).toBe('')
    expect(avertissement()).toBe('Fichier illisible mis de côté.')
    expect(alerte()).toBeUndefined()
  })

  it('garde la liste et montre la raison quand le retrait porte une `erreur` : rien n’a été modifié, c’est un échec', async () => {
    const api = installerApi([{ cwd: ROTATION, brain: 'perso' }])
    api.retirerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'perso' }],
      erreur: 'Fichier des affectations illisible : rien n’a été modifié.'
    })
    await monter()
    await cliquer(bouton('Retirer'))
    expect(api.retirerBrainAffectation).toHaveBeenCalledWith({ cwd: ROTATION })
    expect(selectDe(ROTATION)?.value).toBe('perso')
    expect(alerte()).toBe('Fichier des affectations illisible : rien n’a été modifié.')
    expect(avertissement()).toBeUndefined()
  })

  it('lit aussi dans la liste le changement de Brain d’un dossier déjà assigné : une `erreur` qui accompagne l’écriture est un avertissement', async () => {
    const api = installerApi([{ cwd: ROTATION, brain: 'perso' }])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'equipe' }],
      erreur: 'Fichier illisible mis de côté.'
    })
    await monter()
    await choisir(selectDe(ROTATION), 'equipe')
    expect(selectDe(ROTATION)?.value).toBe('equipe')
    expect(avertissement()).toBe('Fichier illisible mis de côté.')
    expect(alerte()).toBeUndefined()
  })

  it('montre en échec un changement de Brain refusé : la liste renvoyée garde l’ancien Brain', async () => {
    const api = installerApi([{ cwd: ROTATION, brain: 'perso' }])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'perso' }],
      erreur: 'Écriture impossible.'
    })
    await monter()
    await choisir(selectDe(ROTATION), 'equipe')
    expect(selectDe(ROTATION)?.value).toBe('perso')
    expect(alerte()).toBe('Écriture impossible.')
    expect(avertissement()).toBeUndefined()
  })

  it('affiche en avertissement l’`erreur` qui accompagne la liste lue à l’ouverture (fichier présent mais illisible)', async () => {
    const api = installerApi([])
    api.brainAffectations.mockResolvedValueOnce({
      affectations: [],
      erreur: 'Le fichier brain-affectations.json est présent mais illisible.'
    })
    await monter()
    expect(container.textContent).toContain('Aucun dossier assigné')
    expect(avertissement()).toBe('Le fichier brain-affectations.json est présent mais illisible.')
    expect(alerte()).toBeUndefined()
  })

  it('compare le chemin saisi à la liste renvoyée sous forme normalisée (casse, séparateurs, séparateur final)', async () => {
    const api = installerApi([])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'perso' }]
    })
    await monter()
    await saisir(champ(), 'd:/brainrotroyale/')
    await choisir(selectAjout(), 'perso')
    await cliquer(bouton('Assigner'))
    expect(champ().value).toBe('')
  })

  it('change le Brain d’un dossier déjà assigné, puis retire le dossier', async () => {
    const api = installerApi([{ cwd: ROTATION, brain: 'perso' }])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: ROTATION, brain: 'equipe' }]
    })
    await monter()
    await choisir(selectDe(ROTATION), 'equipe')
    expect(api.enregistrerBrainAffectation).toHaveBeenLastCalledWith({
      cwd: ROTATION,
      brain: 'equipe'
    })
    expect(selectDe(ROTATION)?.value).toBe('equipe')
    await cliquer(bouton('Retirer'))
    expect(api.retirerBrainAffectation).toHaveBeenCalledWith({ cwd: ROTATION })
    expect(container.textContent).toContain('Aucun dossier assigné')
  })

  it('dit que la liste n’a pas pu être lue, au lieu d’afficher une liste vide', async () => {
    const api = installerApi()
    api.brainAffectations.mockRejectedValueOnce(new Error('canal coupé'))
    await monter()
    expect(alerte()).toBe('Impossible de lire les dossiers de travail assignés.')
  })

  it('ne fait pas tomber la vue quand le pont manque (application pas à jour)', async () => {
    ;(window as unknown as { api: object }).api = {}
    await monter()
    expect(alerte()).toBe('Impossible de lire les dossiers de travail assignés.')
    expect(container.querySelector('form.dossiers-travail__ajout')).not.toBeNull()
  })
})
