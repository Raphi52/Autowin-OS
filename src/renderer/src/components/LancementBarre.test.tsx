// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LancementBarre } from './LancementBarre'
import type { EtatLancement } from '../../../shared/scripts-copie'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let pousser: ((maj: { conversationId: string; etat: EtatLancement }) => void) | null
const appels: string[] = []

function api(initial: EtatLancement, apresDemarrer?: EtatLancement): void {
  appels.length = 0
  pousser = null
  ;(window as unknown as { api: unknown }).api = {
    lancementEtat: vi.fn(async (id: string) => {
      appels.push(`etat:${id}`)
      return initial
    }),
    lancementDemarrer: vi.fn(async (id: string) => {
      appels.push(`demarrer:${id}`)
      return apresDemarrer ?? initial
    }),
    lancementArreter: vi.fn(async (id: string) => {
      appels.push(`arreter:${id}`)
      return { statut: 'arrete', lignes: [], commande: initial.commande, source: initial.source }
    }),
    onLancement: (cb: typeof pousser) => {
      pousser = cb
      return () => {
        pousser = null
      }
    }
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function rendre(conversationId = 'conv-1'): Promise<void> {
  await act(async () => {
    root.render(createElement(LancementBarre, { conversationId }))
    await Promise.resolve()
    await Promise.resolve()
  })
}
const par = (id: string): HTMLElement | null => container.querySelector(`[data-testid="${id}"]`)
const bouton = (): HTMLButtonElement => par('sc-lancement-bouton') as HTMLButtonElement
async function cliquer(): Promise<void> {
  await act(async () => {
    bouton().click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('LancementBarre', () => {
  it('montre la commande exacte et sa source AVANT le clic', async () => {
    api({ statut: 'arrete', lignes: [], commande: 'npm run dev', source: 'autowin' })
    await rendre()
    expect(appels).toEqual(['etat:conv-1'])
    expect(par('sc-lancement-commande')?.textContent).toBe('npm run dev')
    expect(container.textContent).toContain('.autowin/scripts.json')
    expect(bouton().textContent).toContain('Lancer')
    expect(bouton().disabled).toBe(false)
  })

  it('sans déclaration : bouton inactif et la marche à suivre', async () => {
    api({ statut: 'arrete', lignes: [] })
    await rendre()
    expect(bouton().disabled).toBe(true)
    expect(par('sc-lancement-vide')?.textContent).toContain('"lancement"')
  })

  it('Lancer → en cours ; les mises à jour poussées montrent l’adresse et la sortie ; Arrêter arrête', async () => {
    api(
      { statut: 'arrete', lignes: [], commande: 'npm run dev', source: 'package.json' },
      {
        statut: 'en-cours',
        lignes: [],
        commande: 'npm run dev',
        source: 'package.json',
        port: 23_460
      }
    )
    await rendre()
    expect(container.textContent).toContain('détecté dans package.json')
    await cliquer()
    expect(appels).toContain('demarrer:conv-1')
    expect(par('sc-lancement-etat')?.textContent).toContain('port 23460')
    expect(bouton().textContent).toContain('Arrêter')
    await act(async () => {
      pousser?.({
        conversationId: 'conv-1',
        etat: {
          statut: 'en-cours',
          commande: 'npm run dev',
          source: 'package.json',
          port: 23_460,
          adresse: 'http://localhost:23460/',
          lignes: ['VITE ready', 'Local: http://localhost:23460/']
        }
      })
    })
    const lien = par('sc-lancement-adresse') as HTMLAnchorElement
    expect(lien.getAttribute('href')).toBe('http://localhost:23460/')
    expect(lien.getAttribute('target')).toBe('_blank')
    expect(par('sc-lancement-sortie')?.textContent).toContain('VITE ready')
    // Une mise à jour d'une AUTRE conversation ne touche pas cet écran.
    await act(async () => {
      pousser?.({
        conversationId: 'conv-2',
        etat: { statut: 'echec', lignes: ['x'], erreur: 'autre' }
      })
    })
    expect(par('sc-lancement-erreur')).toBeNull()
    await cliquer()
    expect(appels).toContain('arreter:conv-1')
    expect(bouton().textContent).toContain('Lancer')
  })

  it('un échec dit son code et sa dernière ligne', async () => {
    api({
      statut: 'echec',
      commande: 'npm run dev',
      source: 'autowin',
      code: 1,
      lignes: ['> vite', 'Error: Cannot find module vite']
    })
    await rendre()
    expect(par('sc-lancement-fin')?.textContent).toBe(
      'Échec (code 1) — Error: Cannot find module vite'
    )
  })

  it('une déclaration invalide est MONTRÉE', async () => {
    api({
      statut: 'arrete',
      lignes: [],
      erreur: '.autowin/scripts.json illisible : Unexpected token'
    })
    await rendre()
    expect(par('sc-lancement-erreur')?.textContent).toContain('illisible')
    expect(par('sc-lancement-vide')).toBeNull()
  })
})
