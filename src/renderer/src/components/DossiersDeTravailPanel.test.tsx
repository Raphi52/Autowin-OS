// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DossiersDeTravailPanel } from './DossiersDeTravailPanel'
import {
  CLE_DOSSIERS_CONNUS,
  CLE_DOSSIERS_RETIRES,
  EVT_DOSSIERS_DU_CHAT,
  retirerDossierDuChat
} from './dossiers-du-chat'

const PROJET = 'D:\\MonProjet'
const JOURNAL = 'D:\\Notes\\Journal'
const DEPOT = 'D:\\AutoWinOS'
const PERSONNEL = 'C:\\Users\\moi'

type Demande = ReturnType<typeof vi.fn>
interface ApiDuPanneau {
  brainAffectations: Demande
  enregistrerBrainAffectation: Demande
  executionWorkspace: Demande
  dossierPersonnel: Demande
  boardDossiersDuChat: Demande
}

/**
 * Le pont simulé : les affectations telles que le processus principal les renverrait, plus les deux
 * dossiers que le Chat propose toujours (dépôt de la session, « This computer »).
 */
function installerApi(affectations: unknown[] = []): ApiDuPanneau {
  const api: ApiDuPanneau = {
    brainAffectations: vi.fn().mockResolvedValue({ affectations }),
    enregistrerBrainAffectation: vi.fn().mockResolvedValue({ affectations }),
    executionWorkspace: vi.fn().mockResolvedValue({ path: DEPOT }),
    dossierPersonnel: vi.fn().mockResolvedValue(PERSONNEL),
    boardDossiersDuChat: vi.fn().mockResolvedValue(true)
  }
  ;(window as unknown as { api: ApiDuPanneau }).api = api
  return api
}

/** La liste du menu « Ranger dans… » du Chat, telle qu'il la garde dans le stockage local. */
function poserDossiersDuChat(dossiers: string[], retires: string[] = []): void {
  localStorage.setItem(CLE_DOSSIERS_CONNUS, JSON.stringify(dossiers))
  localStorage.setItem(CLE_DOSSIERS_RETIRES, JSON.stringify(retires))
}

const flush = (): Promise<void> =>
  act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('DossiersDeTravailPanel — la liste est celle des dossiers de travail du Chat', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    localStorage.clear()
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
  /** Les chemins listés, dans l'ordre affiché. */
  const chemins = (): (string | null)[] =>
    [...container.querySelectorAll('.dossiers-travail__chemin')].map((e) => e.textContent)
  const noms = (): (string | null)[] =>
    [...container.querySelectorAll('.dossiers-travail__nom')].map((e) => e.textContent)
  /** Les deux segments Équipe | Perso d'une ligne, retrouvés par leur nom. */
  const segments = (cwd: string): HTMLButtonElement[] => {
    const groupe = [...container.querySelectorAll('[role="group"]')].find(
      (element) => element.getAttribute('aria-label') === `Brain de ${cwd}`
    )
    return groupe ? [...groupe.querySelectorAll<HTMLButtonElement>('button[data-brain]')] : []
  }
  /** Le Brain montré pour un dossier : le segment enfoncé. */
  const brainDe = (cwd: string): string | undefined =>
    segments(cwd)
      .find((segment) => segment.getAttribute('aria-pressed') === 'true')
      ?.getAttribute('data-brain') ?? undefined
  const filtre = (): HTMLInputElement =>
    container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement
  const saisir = async (zone: HTMLInputElement, valeur: string): Promise<void> => {
    const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      poser?.call(zone, valeur)
      zone.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const choisir = async (cwd: string, valeur: string): Promise<void> => {
    const segment = segments(cwd).find((element) => element.getAttribute('data-brain') === valeur)
    if (!segment) throw new Error('segment absent')
    await act(async () => segment.click())
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

  it('liste les dossiers du Chat, « This computer » en tête puis le dépôt de la session', async () => {
    installerApi()
    poserDossiersDuChat([PROJET, JOURNAL])
    await monter()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, PROJET, JOURNAL])
    expect(noms()).toEqual(['💻 This computer', 'AutoWinOS', 'MonProjet', 'Journal'])
  })

  it('ne liste pas un dossier assigné qui n’est pas un dossier du Chat', async () => {
    installerApi([{ cwd: 'D:\\Ailleurs', brain: 'perso' }])
    poserDossiersDuChat([PROJET])
    await monter()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, PROJET])
  })

  it('ne liste pas le dépôt de la session quand sa croix l’a retiré, mais garde « This computer »', async () => {
    installerApi()
    poserDossiersDuChat([PROJET], [DEPOT, PERSONNEL])
    await monter()
    expect(chemins()).toEqual([PERSONNEL, PROJET])
  })

  it('ne répète pas un dossier présent dans le Chat et parmi ceux toujours proposés', async () => {
    installerApi()
    poserDossiersDuChat(['D:/AutoWinOS/', PROJET])
    await monter()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, PROJET])
  })

  it('suit un retrait fait ailleurs pendant que le menu est ouvert', async () => {
    installerApi()
    poserDossiersDuChat([PROJET, JOURNAL])
    await monter()
    await act(async () => {
      retirerDossierDuChat(PROJET)
    })
    await flush()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, JOURNAL])
  })

  it('relit la liste à l’annonce du Chat, même sans retrait', async () => {
    installerApi()
    poserDossiersDuChat([PROJET])
    await monter()
    poserDossiersDuChat([PROJET, JOURNAL])
    await act(async () => {
      window.dispatchEvent(new Event(EVT_DOSSIERS_DU_CHAT))
    })
    await flush()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, PROJET, JOURNAL])
  })

  it('montre le Brain de l’équipe pour un dossier sans affectation', async () => {
    installerApi()
    poserDossiersDuChat([PROJET])
    await monter()
    expect(brainDe(PROJET)).toBe('equipe')
  })

  it('montre le Brain assigné au dossier, chemin comparé sans casse ni séparateur final', async () => {
    installerApi([{ cwd: 'd:/monprojet/', brain: 'perso' }])
    poserDossiersDuChat([PROJET])
    await monter()
    expect(brainDe(PROJET)).toBe('perso')
  })

  it('montre le Brain hérité d’un dossier parent, et le plus précis gagne', async () => {
    installerApi([
      { cwd: 'D:\\Notes', brain: 'perso' },
      { cwd: 'D:\\Notes\\Journal\\Archives', brain: 'equipe' }
    ])
    poserDossiersDuChat([JOURNAL, 'D:\\Notes\\Journal\\Archives', 'D:\\NotesVoisin'])
    await monter()
    expect(brainDe(JOURNAL)).toBe('perso')
    expect(brainDe('D:\\Notes\\Journal\\Archives')).toBe('equipe')
    // Un frère au nom voisin n'est pas un sous-dossier.
    expect(brainDe('D:\\NotesVoisin')).toBe('equipe')
  })

  it('assigne le Brain choisi au dossier, puis montre la liste renvoyée', async () => {
    const api = installerApi()
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: PROJET, brain: 'perso' }]
    })
    poserDossiersDuChat([PROJET])
    await monter()
    await choisir(PROJET, 'perso')
    expect(api.enregistrerBrainAffectation).toHaveBeenCalledWith({ cwd: PROJET, brain: 'perso' })
    expect(brainDe(PROJET)).toBe('perso')
    expect(alerte()).toBeUndefined()
  })

  it('ne redemande rien quand on clique le Brain déjà montré', async () => {
    const api = installerApi([{ cwd: PROJET, brain: 'perso' }])
    poserDossiersDuChat([PROJET])
    await monter()
    await choisir(PROJET, 'perso')
    await choisir(DEPOT, 'equipe')
    expect(api.enregistrerBrainAffectation).not.toHaveBeenCalled()
  })

  it('une `erreur` qui accompagne une écriture réussie est un avertissement, pas une alerte', async () => {
    const api = installerApi([{ cwd: PROJET, brain: 'perso' }])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: PROJET, brain: 'equipe' }],
      erreur: 'Fichier illisible mis de côté.'
    })
    poserDossiersDuChat([PROJET])
    await monter()
    await choisir(PROJET, 'equipe')
    expect(brainDe(PROJET)).toBe('equipe')
    expect(avertissement()).toBe('Fichier illisible mis de côté.')
    expect(alerte()).toBeUndefined()
  })

  it('montre en échec un changement de Brain refusé : la liste renvoyée garde l’ancien Brain', async () => {
    const api = installerApi([{ cwd: PROJET, brain: 'perso' }])
    api.enregistrerBrainAffectation.mockResolvedValueOnce({
      affectations: [{ cwd: PROJET, brain: 'perso' }],
      erreur: 'Écriture impossible.'
    })
    poserDossiersDuChat([PROJET])
    await monter()
    await choisir(PROJET, 'equipe')
    expect(brainDe(PROJET)).toBe('perso')
    expect(alerte()).toBe('Écriture impossible.')
    expect(avertissement()).toBeUndefined()
  })

  it('montre en échec une demande qui n’aboutit pas', async () => {
    const api = installerApi()
    api.enregistrerBrainAffectation.mockRejectedValueOnce(new Error('canal coupé'))
    poserDossiersDuChat([PROJET])
    await monter()
    await choisir(PROJET, 'perso')
    expect(brainDe(PROJET)).toBe('equipe')
    expect(alerte()).toBe('Impossible d’enregistrer cette affectation.')
  })

  it('affiche en avertissement l’`erreur` qui accompagne la liste lue à l’ouverture (fichier présent mais illisible)', async () => {
    const api = installerApi()
    api.brainAffectations.mockResolvedValueOnce({
      affectations: [],
      erreur: 'Le fichier brain-affectations.json est présent mais illisible.'
    })
    poserDossiersDuChat([PROJET])
    await monter()
    expect(avertissement()).toBe('Le fichier brain-affectations.json est présent mais illisible.')
    expect(alerte()).toBeUndefined()
  })

  it('dit que les Brains n’ont pas pu être lus, au lieu de montrer « Équipe » partout', async () => {
    const api = installerApi()
    api.brainAffectations.mockRejectedValueOnce(new Error('canal coupé'))
    poserDossiersDuChat([PROJET])
    await monter()
    expect(alerte()).toBe('Impossible de lire le Brain de chaque dossier de travail.')
    expect(container.querySelector('ul')).toBeNull()
  })

  it('ne fait pas tomber la vue quand le pont manque (application pas à jour)', async () => {
    ;(window as unknown as { api: object }).api = {}
    poserDossiersDuChat([PROJET])
    await monter()
    expect(alerte()).toBe('Impossible de lire le Brain de chaque dossier de travail.')
  })

  it('dit qu’il n’y a aucun dossier de travail quand le Chat n’en a pas', async () => {
    const api = installerApi()
    api.executionWorkspace.mockResolvedValue({ path: '' })
    api.dossierPersonnel.mockResolvedValue('')
    await monter()
    expect(container.textContent).toContain('Aucun dossier de travail')
    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('input[type="search"]')).toBeNull()
  })

  it('montre chaque dossier sur deux lignes : son nom, puis son chemin complet', async () => {
    installerApi()
    poserDossiersDuChat(['D:\\Projets\\Facturation\\Archives'])
    await monter()
    const ligne = [...container.querySelectorAll('.dossiers-travail__ligne')].at(-1)
    expect(ligne?.querySelector('.dossiers-travail__nom')?.textContent).toBe('Archives')
    expect(ligne?.querySelector('.dossiers-travail__chemin')?.textContent).toBe(
      'D:\\Projets\\Facturation\\Archives'
    )
  })

  it('filtre les dossiers sur leur chemin ou leur nom, sans tenir compte de la casse, et dit quand rien ne correspond', async () => {
    installerApi()
    poserDossiersDuChat([PROJET, JOURNAL])
    await monter()
    await saisir(filtre(), 'journal')
    expect(chemins()).toEqual([JOURNAL])
    await saisir(filtre(), 'this comp')
    expect(chemins()).toEqual([PERSONNEL])
    await saisir(filtre(), 'introuvable')
    expect(container.querySelector('ul')).toBeNull()
    expect(container.textContent).toContain('Aucun dossier ne correspond.')
  })

  /** La croix d'une ligne, retrouvée par son nom. */
  const croix = (cwd: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll<HTMLButtonElement>('button.dossiers-travail__croix')].find(
      (b) =>
        b.getAttribute('aria-label') ===
        `Retirer ${cwd} des dossiers de travail du Chat (et du Board)`
    )

  it('la croix retire le dossier de la liste du Chat : il quitte ce menu, la mémoire du Chat et part au Board', async () => {
    const api = installerApi()
    poserDossiersDuChat([PROJET, JOURNAL])
    await monter()
    await act(async () => croix(PROJET)?.click())
    await flush()
    expect(chemins()).toEqual([PERSONNEL, DEPOT, JOURNAL])
    expect(JSON.parse(localStorage.getItem(CLE_DOSSIERS_CONNUS) ?? '[]')).toEqual([JOURNAL])
    expect(JSON.parse(localStorage.getItem(CLE_DOSSIERS_RETIRES) ?? '[]')).toContain(PROJET)
    expect(api.boardDossiersDuChat).toHaveBeenLastCalledWith([JOURNAL], [PROJET])
  })

  it('la croix retire aussi le dépôt de la session, que le Chat propose toujours', async () => {
    installerApi()
    poserDossiersDuChat([PROJET])
    await monter()
    await act(async () => croix(DEPOT)?.click())
    await flush()
    expect(chemins()).toEqual([PERSONNEL, PROJET])
  })

  it('« This computer » n’a pas de croix : il ne se retire jamais', async () => {
    installerApi()
    poserDossiersDuChat([PROJET])
    await monter()
    expect(croix(PERSONNEL)).toBeUndefined()
    expect(croix(PROJET)).toBeDefined()
    expect(container.querySelectorAll('button.dossiers-travail__croix')).toHaveLength(2)
  })

  it('n’a pas d’ajout d’un chemin libre : un dossier s’ajoute depuis le Chat', async () => {
    installerApi([{ cwd: PROJET, brain: 'perso' }])
    poserDossiersDuChat([PROJET])
    await monter()
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('input[type="text"]')).toBeNull()
    const libelles = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(libelles).not.toContain('Assigner')
  })
})
