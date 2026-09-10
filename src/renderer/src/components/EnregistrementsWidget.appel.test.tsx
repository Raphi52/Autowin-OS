// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LE MODE CONVERSATION, prouvé sans micro ni carte son.
 *
 * Ce qui est vérifié ici est exactement ce que l'utilisateur a demandé, et rien d'autre :
 *  - le micro CHOISI est celui que le moteur reçoit (sinon le réglage serait décoratif) ;
 *  - deux flux sont ouverts, l'un sur le micro, l'autre sur le son du système ;
 *  - chaque phrase part sur le DISQUE en disant qui parle ;
 *  - sans reconnaissance hors ligne, le mode est REFUSÉ avant d'ouvrir un fichier.
 * La fabrique de moteurs est remplacée : c'est la seule frontière avec le matériel.
 */

class FauxMoteur {
  continuous = false
  interimResults = false
  lang = ''
  demarrages = 0
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  start(): void {
    this.demarrages += 1
  }
  arrets = 0
  stop(): void {
    this.arrets += 1
  }
  dire(texte: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: texte }], { isFinal: true })]
    })
  }
}

const moteurs: FauxMoteur[] = []
const appelsFabrique: Array<{ whisper: boolean; peripherique?: string; source?: string }> = []
let whisperDispo = true

vi.mock('./jarvis-moteur', () => ({
  fabriqueMoteur: (whisper: boolean, peripherique?: string, source?: string) => {
    appelsFabrique.push({ whisper, peripherique, source })
    // Le vrai `fabriqueMoteur` refuse le son du système sans reconnaissance hors ligne.
    if (source === 'haut-parleurs' && !whisper) return null
    return class extends FauxMoteur {
      constructor() {
        super()
        moteurs.push(this)
      }
    }
  }
}))

const { EnregistrementsWidget } = await import('./EnregistrementsWidget')

const ecrit: string[] = []
const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function rendre(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(EnregistrementsWidget)))
  monte.push({ root, container })
  return container
}

const choisir = (c: HTMLElement, testid: string, valeur: string): void => {
  const select = c.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)
  if (!select) throw new Error(`champ absent : ${testid}`)
  act(() => {
    select.value = valeur
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const clic = (c: HTMLElement, testid: string): void => {
  const bouton = c.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!bouton) throw new Error(`bouton absent : ${testid}`)
  act(() => bouton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  moteurs.length = 0
  appelsFabrique.length = 0
  ecrit.length = 0
  whisperDispo = true
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'casque-1', label: 'Casque Jabra' },
      { kind: 'audiooutput', deviceId: 'hp', label: 'Haut-parleurs' }
    ],
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  ;(window as never as Record<string, unknown>).api = {
    whisperEtat: async () => ({ installe: whisperDispo }),
    transcriptDemarrer: async () => ({ id: 's-1', nom: 'appel.txt', chemin: 'C:/t/appel.txt' }),
    transcriptAjouter: async (_id: string, texte: string) => {
      ecrit.push(texte)
      return { octets: ecrit.join('\n').length }
    },
    transcriptTerminer: async () => ({ chemin: 'C:/t/appel.txt' }),
    transcriptLister: async () => [],
    transcriptRevealer: async () => ({ ok: true as const })
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

const attendre = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('widget Enregistrements — micro choisi et mode conversation', () => {
  it('PROPOSE les micros de la machine et passe celui qu on choisit au moteur', async () => {
    const c = rendre()
    await attendre()
    const options = [
      ...c.querySelectorAll('[data-testid="enregistrements-peripherique"] option')
    ].map((o) => o.textContent)
    expect(options).toEqual(['Micro par défaut du système', 'Casque Jabra'])

    choisir(c, 'enregistrements-peripherique', 'casque-1')
    clic(c, 'enregistrements-bascule')
    await attendre()
    expect(appelsFabrique.some((a) => a.peripherique === 'casque-1' && a.source === 'micro')).toBe(
      true
    )
  })

  it('OUVRE DEUX FLUX en conversation et ECRIT qui parle', async () => {
    const c = rendre()
    await attendre()
    choisir(c, 'enregistrements-mode', 'appel')
    clic(c, 'enregistrements-bascule')
    await attendre()

    const sources = appelsFabrique.filter((a) => a.source).map((a) => a.source)
    expect(sources).toContain('micro')
    expect(sources).toContain('haut-parleurs')
    expect(moteurs.filter((m) => m.demarrages > 0)).toHaveLength(2)

    act(() => moteurs[0].dire('bonjour, on se voit demain'))
    act(() => moteurs[1].dire('oui, 14 h me va'))
    await attendre()
    expect(ecrit).toEqual(['Moi : bonjour, on se voit demain', 'Interlocuteur : oui, 14 h me va'])
  })

  it('n ATTRIBUE PAS les lignes en dictee simple : un seul locuteur, aucun prefixe', async () => {
    const c = rendre()
    await attendre()
    clic(c, 'enregistrements-bascule')
    await attendre()
    act(() => moteurs[0].dire('note pour moi'))
    await attendre()
    expect(ecrit).toEqual(['note pour moi'])
  })

  it('REFUSE la conversation sans reconnaissance hors ligne, AVANT d ouvrir un fichier', async () => {
    whisperDispo = false
    const c = rendre()
    await attendre()
    choisir(c, 'enregistrements-mode', 'appel')
    clic(c, 'enregistrements-bascule')
    await attendre()
    expect(moteurs).toHaveLength(0)
    expect(ecrit).toHaveLength(0)
    expect(c.querySelector('[data-testid="enregistrements-erreur"]')?.textContent).toContain(
      'reconnaissance hors ligne'
    )
  })

  it('ARRETE TOUT quand le son du systeme tombe : un appel a une seule voix est un faux transcript', async () => {
    const c = rendre()
    await attendre()
    choisir(c, 'enregistrements-mode', 'appel')
    clic(c, 'enregistrements-bascule')
    await attendre()
    act(() => moteurs[1].onerror?.({ error: 'not-allowed' }))
    await attendre()
    expect(c.querySelector('[data-testid="enregistrements-erreur"]')?.textContent).toContain(
      'son du système'
    )
    expect(c.querySelector('[data-testid="enregistrements-etat"]')?.textContent).toContain(
      'Micro coupé'
    )
  })
})
